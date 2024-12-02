package receiver

import (
	"encoding/json"
	"log"
	"net/http"
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
	bmp        *BMP180
	bmpReadings chan BMP180Reading
}

type BMP180Reading struct {
    Type        string  `json:"type"`
    Temperature float64 `json:"temperature"`
    Pressure    float64 `json:"pressure"`
    Timestamp   int64   `json:"timestamp"`
}

func NewServer() *Server {
	s := &Server{
		readings:     make(chan Reading),
		statusChan:   make(chan StatusMessage),
		bmpReadings:  make(chan BMP180Reading),
	}
	ws := NewWebSocketServer()
	ws.server = s
	s.wsServer = ws

	bmp, err := NewBMP180()
	if err != nil {
		log.Printf("Failed to initialize BMP180: %v", err)
	} else {
		s.bmp = bmp
	}

	return s
}

func (s *Server) Start() {
	go s.wsServer.Start()

	http.HandleFunc("/serial_ports", s.handleListSerialPorts)
	http.HandleFunc("/connect", s.handleConnectSerialPort)
	http.HandleFunc("/tare", s.handleTare)

	go s.broadcastMessages()

	// Start BMP180 monitoring if available
	if s.bmp != nil {
		go s.monitorBMP180()
	}

	// Block main goroutine
	select {}
}

func (s *Server) broadcastMessages() {
	for {
		select {
		case reading := <-s.readings:
			s.wsServer.Broadcast(reading)
		case status := <-s.statusChan:
			s.wsServer.Broadcast(status)
		case bmpReading := <-s.bmpReadings:
			s.wsServer.Broadcast(bmpReading)
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
        temp, pressure, err := s.bmp.ReadTemperaturePressure()
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

        s.bmpReadings <- reading
    }
}