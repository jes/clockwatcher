package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type WebSocketServer struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan interface{}
	upgrader   websocket.Upgrader
	clientsMux sync.Mutex
}

func NewWebSocketServer() *WebSocketServer {
	return &WebSocketServer{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan interface{}),
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

	log.Println("New WebSocket client connected")
	defer func() {
		s.clientsMux.Lock()
		delete(s.clients, ws)
		s.clientsMux.Unlock()
		log.Println("WebSocket client disconnected")
	}()

	for {
		// Keep the connection alive by reading messages (if needed)
		_, _, err := ws.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (s *WebSocketServer) handleBroadcasts() {
	for msg := range s.broadcast {
		s.clientsMux.Lock()
		message, err := json.Marshal(msg)
		if err != nil {
			log.Printf("Error marshaling message: %v", err)
			continue
		}
		for client := range s.clients {
			err := client.WriteMessage(websocket.TextMessage, message)
			if err != nil {
				log.Printf("WebSocket error: %v", err)
				client.Close()
				delete(s.clients, client)
			}
		}
		s.clientsMux.Unlock()
	}
}

func (s *WebSocketServer) Broadcast(msg interface{}) {
	s.broadcast <- msg
}
