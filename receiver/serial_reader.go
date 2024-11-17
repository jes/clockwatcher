package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"time"

	"go.bug.st/serial"
)

type Reading struct {
	Timestamp   uint32 `json:"timestamp"`
	TotalMicros uint64 `json:"total_micros"`
	Count       int    `json:"count"`
}

type StatusMessage struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type SerialReader struct {
	port              serial.Port
	buffer            []byte
	lastTimestamp     uint32
	overflowCount     uint64
	count             int
	consecutiveErrors int
	statusChan        chan StatusMessage
}

func NewSerialReader(port serial.Port, statusChan chan StatusMessage) *SerialReader {
	return &SerialReader{
		port:       port,
		buffer:     make([]byte, 5),
		statusChan: statusChan,
	}
}

func (sr *SerialReader) StartReading(readings chan<- Reading) {
	// Notify that serial reading has started
	sr.statusChan <- StatusMessage{Status: "Serial Reader Started"}

	const maxConsecutiveErrors = 10

	for {
		if sr.consecutiveErrors >= maxConsecutiveErrors {
			errMsg := fmt.Sprintf("Too many consecutive read errors (%d)", sr.consecutiveErrors)
			log.Println(errMsg)
			sr.statusChan <- StatusMessage{Status: "Error", Error: errMsg}
			// Reset error count to continue reading
			sr.consecutiveErrors = 0
			time.Sleep(2 * time.Second) // Wait before retrying
			continue
		}

		timestamp, direction, ok := sr.readAndValidatePacket()
		if !ok {
			continue
		}

		// Handle timestamp overflow
		if timestamp < sr.lastTimestamp {
			sr.overflowCount++
			log.Printf("Timestamp overflow detected! Count: %d", sr.overflowCount)
			sr.statusChan <- StatusMessage{Status: "Overflow", Error: fmt.Sprintf("Overflow count: %d", sr.overflowCount)}
		}
		sr.lastTimestamp = timestamp

		// Update count based on direction
		if direction == 1 {
			sr.count++
		} else {
			sr.count--
		}

		totalMicroseconds := uint64(timestamp) + (sr.overflowCount * 0xFFFFFFFF)
		readings <- Reading{
			Timestamp:   timestamp,
			TotalMicros: totalMicroseconds,
			Count:       sr.count,
		}
	}
}

func (sr *SerialReader) readAndValidatePacket() (uint32, uint8, bool) {
	// Read exactly 5 bytes
	n, err := io.ReadFull(sr.port, sr.buffer)
	if err != nil || n != 5 {
		log.Printf("Error reading from serial: %v", err)
		sr.consecutiveErrors++
		sr.statusChan <- StatusMessage{Status: "Serial Error", Error: err.Error()}
		return 0, 0, false
	}
	sr.consecutiveErrors = 0

	if sr.isOverflow() {
		log.Println("Buffer overflow detected!")
		sr.statusChan <- StatusMessage{Status: "Overflow", Error: "Buffer overflow detected"}
		return 0, 0, false
	}

	if !sr.validateChecksum() {
		return 0, 0, false
	}

	timestamp := binary.BigEndian.Uint32(sr.buffer[:4])
	direction := (sr.buffer[4] >> 7) & 1

	return timestamp, direction, true
}

func (sr *SerialReader) isOverflow() bool {
	for i := 0; i < 5; i++ {
		if sr.buffer[i] != 0xFF {
			return false
		}
	}
	return true
}

func (sr *SerialReader) validateChecksum() bool {
	calculatedChecksum := uint8(0)
	for i := 0; i < 4; i++ {
		calculatedChecksum ^= sr.buffer[i]
	}
	calculatedChecksum &= 0x7F

	receivedChecksum := sr.buffer[4] & 0x7F

	if calculatedChecksum != receivedChecksum {
		log.Printf("Checksum mismatch! Bytes: %02x %02x %02x %02x, Final: %02x",
			sr.buffer[0], sr.buffer[1], sr.buffer[2], sr.buffer[3], sr.buffer[4])
		log.Printf("Calculated: %02x, Received: %02x", calculatedChecksum, receivedChecksum)
		return false
	}
	return true
}
