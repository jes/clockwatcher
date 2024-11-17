package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"io"
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

	// Buffer for reading 5 bytes at a time (4 for timestamp, 1 for direction+checksum)
	buffer := make([]byte, 5)

	var lastTimestamp uint32
	var overflowCount uint64

	for {
		// Read exactly 5 bytes
		n, err := io.ReadFull(port, buffer)
		if err != nil || n != 5 {
			log.Printf("Error reading from serial: %v", err)
			continue
		}

		// Calculate checksum
		calculatedChecksum := uint8(0)
		for i := 0; i < 4; i++ {
			calculatedChecksum ^= buffer[i]
		}
		calculatedChecksum &= 0x7F

		finalByte := buffer[4]
		direction := (finalByte >> 7) & 1
		receivedChecksum := finalByte & 0x7F

		// Debug output
		if calculatedChecksum != receivedChecksum {
			log.Printf("Checksum mismatch! Bytes: %02x %02x %02x %02x, Final: %02x",
				buffer[0], buffer[1], buffer[2], buffer[3], buffer[4])
			log.Printf("Calculated: %02x, Received: %02x", calculatedChecksum, receivedChecksum)
			continue
		}

		// Check for overflow marker (all five bytes should be 0xFF)
		isOverflow := true
		for i := 0; i < 5; i++ {
			if buffer[i] != 0xFF {
				isOverflow = false
				break
			}
		}
		if isOverflow {
			log.Println("Buffer overflow detected!")
			continue
		}

		// Convert timestamp bytes to uint32
		timestamp := binary.BigEndian.Uint32(buffer[:4])

		// Detect timestamp overflow
		if timestamp < lastTimestamp {
			overflowCount++
			log.Printf("Timestamp overflow detected! Count: %d", overflowCount)
		}
		lastTimestamp = timestamp

		// Convert direction bit to string
		dirString := "negative"
		if direction == 1 {
			dirString = "positive"
		}

		// Print timestamp (microseconds) and direction with total time including overflows
		totalMicroseconds := uint64(timestamp) + (overflowCount * 0xFFFFFFFF)
		fmt.Printf("Time: %s (Total: %s), Direction: %s\n",
			time.Duration(timestamp)*time.Microsecond,
			time.Duration(totalMicroseconds)*time.Microsecond,
			dirString)
	}
}
