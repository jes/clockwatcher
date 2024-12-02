package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"go.bug.st/serial"
)

type Server struct {
	wsServer   *WebSocketServer
	readings   chan Reading
	statusChan chan StatusMessage
	serialPort serial.Port
	serialMux  sync.Mutex
	tareOffset int
}

func NewServer() *Server {
	s := &Server{
		readings:   make(chan Reading),
		statusChan: make(chan StatusMessage),
	}
	ws := NewWebSocketServer()
	ws.server = s
	s.wsServer = ws
	return s
}

func (s *Server) Start() {
	go s.wsServer.Start()

	http.HandleFunc("/serial_ports", s.handleListSerialPorts)
	http.HandleFunc("/connect", s.handleConnectSerialPort)
	http.HandleFunc("/tare", s.handleTare)

	go s.broadcastMessages()

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

func main() {
	server := NewServer()
	server.Start()
}
