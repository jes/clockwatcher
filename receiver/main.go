package main

import (
	"encoding/binary"
	"encoding/csv"
	"flag"
	"fmt"
	"io"
	"log"
	"os"

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
	var count int
	const maxConsecutiveErrors = 10
	consecutiveErrors := 0

	// Set up CSV writer
	csvWriter := csv.NewWriter(os.Stdout)
	defer csvWriter.Flush()

	// Write CSV header
	csvWriter.Write([]string{"Timestamp_us", "Total_Time_us", "Count"})

	for {
		// Read exactly 5 bytes
		n, err := io.ReadFull(port, buffer)
		if err != nil || n != 5 {
			log.Printf("Error reading from serial: %v", err)
			consecutiveErrors++
			if consecutiveErrors >= maxConsecutiveErrors {
				log.Fatalf("Too many consecutive read errors (%d). Exiting.", consecutiveErrors)
			}
			continue
		}
		consecutiveErrors = 0 // Reset counter on successful read

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

		// Replace direction string logic with count tracking
		if direction == 1 {
			count++
		} else {
			count--
		}

		// Print timestamp (microseconds) and direction with total time including overflows
		totalMicroseconds := uint64(timestamp) + (overflowCount * 0xFFFFFFFF)
		err = csvWriter.Write([]string{
			fmt.Sprintf("%d", timestamp),
			fmt.Sprintf("%d", totalMicroseconds),
			fmt.Sprintf("%d", count),
		})
		if err != nil {
			log.Printf("Error writing CSV: %v", err)
		}
		csvWriter.Flush()
	}
}
