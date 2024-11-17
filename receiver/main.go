package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"time"

	"go.bug.st/serial"
)

func main() {
	// Command line flags for serial port configuration
	portName := flag.String("port", "/dev/ttyUSB0", "Serial port name")
	baudRate := flag.Int("baud", 115200, "Baud rate")
	flag.Parse()

	// Configure serial port
	mode := &serial.Mode{
		BaudRate: *baudRate,
	}

	// Open serial port
	port, err := serial.Open(*portName, mode)
	if err != nil {
		log.Fatalf("Failed to open serial port: %v", err)
	}
	defer port.Close()

	// Buffer for reading 4 bytes at a time (uint32)
	buffer := make([]byte, 4)

	for {
		// Read exactly 4 bytes
		_, err := port.Read(buffer)
		if err != nil {
			log.Printf("Error reading from serial: %v", err)
			continue
		}

		// Convert bytes to uint32
		data := binary.BigEndian.Uint32(buffer)

		// Check for overflow marker
		if data == 0xFFFFFFFF {
			log.Println("Buffer overflow detected!")
			continue
		}

		// Extract direction and timestamp
		direction := (data >> 31) & 1
		timestamp := data & 0x7FFFFFFF // Remove direction bit

		// Convert direction bit to string
		dirString := "negative"
		if direction == 1 {
			dirString = "positive"
		}

		// Print timestamp (microseconds) and direction
		fmt.Printf("Time: %s, Direction: %s\n",
			time.Duration(timestamp)*time.Microsecond,
			dirString)
	}
}
