package receiver

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"go.bug.st/serial"
)

type Server struct {
	wsServer   *WebSocketServer
	readings   chan Reading
	statusChan chan StatusMessage
	serialPort serial.Port
	serialMux  sync.Mutex
	tareOffset int
	bmp180        *BMP180
	bmp180Readings chan BMP180Reading
	bmp390        *BMP390
	bmp390Readings chan BMP390Reading
	sht           *SHT85
	shtReadings   chan SHT85Reading
	dataRecorder  *DataRecorder
}

type BMP180Reading struct {
    Type        string  `json:"type"`
    Temperature float64 `json:"temperature"`
    Pressure    float64 `json:"pressure"`
    Timestamp   int64   `json:"timestamp"`
}

type BMP390Reading struct {
    Type        string  `json:"type"`
    Temperature float64 `json:"temperature"`
    Pressure    float64 `json:"pressure"`
    Timestamp   int64   `json:"timestamp"`
}

type SHT85Reading struct {
	Type        string  `json:"type"`
	Temperature float64 `json:"temperature"`
	Humidity    float64 `json:"humidity"`
	Timestamp   int64   `json:"timestamp"`
}

func NewServer() *Server {
	s := &Server{
		readings:     make(chan Reading),
		statusChan:   make(chan StatusMessage),
		bmp180Readings:  make(chan BMP180Reading),
		bmp390Readings:  make(chan BMP390Reading),
		shtReadings:  make(chan SHT85Reading),
	}
	dr, err := NewDataRecorder()
	if err != nil {
		log.Printf("Failed to initialize DataRecorder: %v", err)
	} else {
		s.dataRecorder = dr
	}

	ws := NewWebSocketServer()
	ws.server = s
	s.wsServer = ws

	bmp180, err := NewBMP180()
	if err != nil {
		log.Printf("Failed to initialize BMP180: %v", err)
	} else {
		s.bmp180 = bmp180
	}

	bmp390, err := NewBMP390()
	if err != nil {
		log.Printf("Failed to initialize BMP390: %v", err)
	} else {
		s.bmp390 = bmp390
	}

	sht, err := NewSHT85()
	if err != nil {
		log.Printf("Failed to initialize SHT85: %v", err)
	} else {
		s.sht = sht
	}

	return s
}

func (s *Server) Start() {
	go s.wsServer.Start()

	http.HandleFunc("/serial_ports", s.handleListSerialPorts)
	http.HandleFunc("/connect", s.handleConnectSerialPort)
	http.HandleFunc("/tare", s.handleTare)
	http.HandleFunc("/historical_data", s.handleHistoricalData)

	go s.broadcastMessages()

	// Start BMP180 monitoring if available
	if s.bmp180 != nil {
		go s.monitorBMP180()
	}

	// Start BMP390 monitoring if available
	if s.bmp390 != nil {
		go s.monitorBMP390()
	}

	// Start SHT85 monitoring if available
	if s.sht != nil {
		go s.monitorSHT85()
	}

	// Block main goroutine
	select {}
}

func (s *Server) broadcastMessages() {
	for {
		select {
		case reading := <-s.readings:
			if s.dataRecorder != nil {
				s.dataRecorder.AddReading(reading, int(s.tareOffset))
			}
			s.wsServer.Broadcast(reading)
		case status := <-s.statusChan:
			s.wsServer.Broadcast(status)
		case bmp180Reading := <-s.bmp180Readings:
			if s.dataRecorder != nil {
				s.dataRecorder.UpdateBMP180(bmp180Reading)
			}
			s.wsServer.Broadcast(bmp180Reading)
		case bmp390Reading := <-s.bmp390Readings:
			if s.dataRecorder != nil {
				s.dataRecorder.UpdateBMP390(bmp390Reading)
			}
			s.wsServer.Broadcast(bmp390Reading)
		case shtReading := <-s.shtReadings:
			if s.dataRecorder != nil {
				s.dataRecorder.UpdateSHT85(shtReading)
			}
			s.wsServer.Broadcast(shtReading)
		}
	}
}

func (s *Server) handleListSerialPorts(w http.ResponseWriter, r *http.Request) {
	ports, err := serial.GetPortsList()
	if err != nil {
		http.Error(w, "Failed to list serial ports", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(ports)
}

func (s *Server) handleConnectSerialPort(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		PortName string `json:"port_name"`
		BaudRate int    `json:"baud_rate"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	s.serialMux.Lock()
	defer s.serialMux.Unlock()

	// Close existing port if connected
	if s.serialPort != nil {
		s.serialPort.Close()
		s.serialPort = nil
	}

	mode := &serial.Mode{BaudRate: req.BaudRate}
	port, err := serial.Open(req.PortName, mode)
	if err != nil {
		log.Printf("Failed to open serial port %s: %v", req.PortName, err)
		s.statusChan <- StatusMessage{Status: "Serial Error", Error: err.Error()}
		http.Error(w, "Failed to open serial port", http.StatusInternalServerError)
		return
	}

	s.serialPort = port
	serialReader := NewSerialReader(port, s.statusChan)
	go serialReader.StartReading(s.readings)

	log.Printf("Connected to %s with baud rate %d", req.PortName, req.BaudRate)
	w.WriteHeader(http.StatusOK)
}

func (s *Server) getCurrentSerialStatus() StatusMessage {
	s.serialMux.Lock()
	defer s.serialMux.Unlock()

	if s.serialPort == nil {
		return StatusMessage{
			Device: DeviceTypeSerial,
			Status: StatusDisconnected,
		}
	}
	return StatusMessage{
		Device: DeviceTypeSerial,
		Status: StatusConnected,
	}
}

func (s *Server) handleTare(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		json.NewEncoder(w).Encode(map[string]int{
			"value": s.tareOffset,
		})

	case http.MethodPost:
		var req struct {
			Value int `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		s.tareOffset = req.Value
		w.WriteHeader(http.StatusOK)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) monitorBMP180() {
    ticker := time.NewTicker(2 * time.Second)
    defer ticker.Stop()

    for range ticker.C {
        temp, pressure, err := s.bmp180.ReadTemperaturePressure()
        if err != nil {
            log.Printf("Error reading BMP180: %v", err)
            continue
        }

        reading := BMP180Reading{
            Type:        "BMP180",
            Temperature: temp,
            Pressure:    pressure,
            Timestamp:   time.Now().UnixMicro(),
        }

        s.bmp180Readings <- reading
    }
}

func (s *Server) monitorBMP390() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		temp, pressure, err := s.bmp390.ReadTemperaturePressure()
		if err != nil {
			log.Printf("Error reading BMP390: %v", err)
			continue
		}

		reading := BMP390Reading{
			Type:        "BMP390",
			Temperature: temp,
			Pressure:    pressure,
			Timestamp:   time.Now().UnixMicro(),
		}

		s.bmp390Readings <- reading
	}
}

func (s *Server) monitorSHT85() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		temp, humidity, err := s.sht.ReadTemperatureHumidity()
		if err != nil {
			log.Printf("Error reading SHT85: %v", err)
			continue
		}

		reading := SHT85Reading{
			Type:        "SHT85",
			Temperature: temp,
			Humidity:    humidity,
			Timestamp:   time.Now().UnixMicro(),
		}

		s.shtReadings <- reading
	}
}

func (s *Server) handleHistoricalData(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse query parameters
	startTime, err := strconv.ParseInt(r.URL.Query().Get("start"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid start time", http.StatusBadRequest)
		return
	}

	endTime, err := strconv.ParseInt(r.URL.Query().Get("end"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid end time", http.StatusBadRequest)
		return
	}

	if s.dataRecorder == nil {
		http.Error(w, "Data recorder not initialized", http.StatusInternalServerError)
		return
	}

	data, err := s.dataRecorder.GetHistoricalData(startTime, endTime)
	if err != nil {
		http.Error(w, "Database query failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}