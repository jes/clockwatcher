package receiver

import (
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"time"

	"go.bug.st/serial"
)

const (
	DeviceTypeSerial = "SERIAL"

	StatusDisconnected = "DISCONNECTED"
	StatusConnected    = "CONNECTED"
	StatusOverflow     = "OVERFLOW"
	StatusError        = "ERROR"
)

type Reading struct {
	TotalMicros uint64 `json:"TotalMicros"`
	Count       int    `json:"Count"`
	TimestampDrift  int64  `json:"TimestampDrift"`
}

type StatusMessage struct {
	Device string `json:"Device"`
	Status string `json:"Status"`
	Error  string `json:"Error,omitempty"`
}

type SerialReader struct {
	port              serial.Port
	buffer            []byte
	lastTimestamp     uint32
	overflowCount     uint64
	count             int
	consecutiveErrors int
	statusChan        chan StatusMessage
	done              chan struct{}
	timeOffset        int64    // Unix epoch microseconds when first reading received
	firstTimestamp    uint64   // First device timestamp in microseconds
}

func NewSerialReader(port serial.Port, statusChan chan StatusMessage) *SerialReader {
	return &SerialReader{
		port:       port,
		buffer:     make([]byte, 5),
		statusChan: statusChan,
		done:       make(chan struct{}),
	}
}

func (sr *SerialReader) StartReading(readings chan<- Reading) {
	// Notify that serial reading has started
	sr.statusChan <- StatusMessage{
		Device: DeviceTypeSerial,
		Status: StatusConnected,
	}

	const maxConsecutiveErrors = 10
	defer func() {
		sr.port.Close()
		close(sr.done)
		sr.statusChan <- StatusMessage{
			Device: DeviceTypeSerial,
			Status: StatusDisconnected,
		}
	}()

	var lastReadingTime int64 // Track the last reading time in Unix micros

	for {
		if sr.consecutiveErrors >= maxConsecutiveErrors {
			errMsg := fmt.Sprintf("Too many consecutive read errors (%d), disconnecting", sr.consecutiveErrors)
			log.Println(errMsg)
			sr.statusChan <- StatusMessage{
				Device: DeviceTypeSerial,
				Status: StatusError,
				Error:  errMsg,
			}
			return // This will trigger the deferred cleanup
		}

		timestamp, direction, currentTime, ok := sr.readAndValidatePacket()
		if !ok {
			continue
		}

		// Initialize time offset on first reading
		if sr.timeOffset == 0 {
			sr.timeOffset = currentTime
			sr.firstTimestamp = uint64(timestamp)
		} else {
			// Check if more than 60 seconds have elapsed since last reading
			if currentTime-lastReadingTime > 60*1000000 {
				// Resync the time offset
				sr.timeOffset = currentTime
				sr.firstTimestamp = uint64(timestamp)
				sr.overflowCount = 0 // Reset overflow count with new sync
				log.Printf("Resyncing time offset due to >60s gap between readings")
			}
		}
		lastReadingTime = currentTime

		// Handle timestamp overflow
		if timestamp < sr.lastTimestamp {
			sr.overflowCount++
			log.Printf("Timestamp overflow detected! Count: %d", sr.overflowCount)
			sr.statusChan <- StatusMessage{
				Device: DeviceTypeSerial,
				Status: StatusOverflow,
				Error:  fmt.Sprintf("Overflow count: %d", sr.overflowCount),
			}
		}
		sr.lastTimestamp = timestamp

		// Calculate device microseconds since first reading
		deviceMicros := uint64(timestamp) + (sr.overflowCount * 0xFFFFFFFF) - sr.firstTimestamp

		// Calculate actual Unix epoch microseconds
		totalMicros := sr.timeOffset + int64(deviceMicros)

		// Update count based on direction
		if direction == 1 {
			sr.count++
		} else {
			sr.count--
		}

		reading := Reading{
			TotalMicros: uint64(totalMicros),
			Count:       sr.count,
			TimestampDrift:  currentTime - int64(totalMicros),
		}

		readings <- reading
	}
}

func (sr *SerialReader) readAndValidatePacket() (uint32, uint8, int64, bool) {
	// Read exactly 5 bytes
	n, err := io.ReadFull(sr.port, sr.buffer)
	currentTime := time.Now().UnixMicro()
	if err != nil || n != 5 {
		log.Printf("Error reading from serial: %v", err)
		sr.consecutiveErrors++
		sr.statusChan <- StatusMessage{
			Device: DeviceTypeSerial,
			Status: StatusError,
			Error:  err.Error(),
		}
		return 0, 0, currentTime, false
	}
	sr.consecutiveErrors = 0

	if sr.isOverflow() {
		log.Println("Buffer overflow detected!")
		sr.statusChan <- StatusMessage{
			Device: DeviceTypeSerial,
			Status: StatusOverflow,
			Error:  "Buffer overflow detected",
		}
		return 0, 0, currentTime, false
	}

	if !sr.validateChecksum() {
		return 0, 0, currentTime, false
	}

	timestamp := binary.BigEndian.Uint32(sr.buffer[:4])
	direction := (sr.buffer[4] >> 7) & 1

	return timestamp, direction, currentTime, true
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
