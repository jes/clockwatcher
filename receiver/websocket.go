package main

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type WebSocketServer struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan Reading
	upgrader   websocket.Upgrader
	clientsMux sync.Mutex
}

func NewWebSocketServer() *WebSocketServer {
	return &WebSocketServer{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan Reading),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for demo
			},
		},
	}
}

func (s *WebSocketServer) Start() {
	// Serve static files
	http.Handle("/", http.FileServer(http.Dir("static")))

	// Handle WebSocket connections
	http.HandleFunc("/ws", s.handleConnections)

	// Start broadcasting goroutine
	go s.handleBroadcasts()

	// Start HTTP server
	go func() {
		log.Printf("Starting web server on :8080")
		if err := http.ListenAndServe(":8080", nil); err != nil {
			log.Fatal("HTTP server error:", err)
		}
	}()
}

func (s *WebSocketServer) handleConnections(w http.ResponseWriter, r *http.Request) {
	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer ws.Close()

	s.clientsMux.Lock()
	s.clients[ws] = true
	s.clientsMux.Unlock()

	// Keep connection alive until client disconnects
	for {
		if _, _, err := ws.ReadMessage(); err != nil {
			s.clientsMux.Lock()
			delete(s.clients, ws)
			s.clientsMux.Unlock()
			break
		}
	}
}

func (s *WebSocketServer) handleBroadcasts() {
	for reading := range s.broadcast {
		s.clientsMux.Lock()
		for client := range s.clients {
			err := client.WriteJSON(reading)
			if err != nil {
				log.Printf("WebSocket error: %v", err)
				client.Close()
				delete(s.clients, client)
			}
		}
		s.clientsMux.Unlock()
	}
}
