package receiver

import (
	"encoding/binary"
	"fmt"
	"periph.io/x/conn/v3/i2c"
	"periph.io/x/conn/v3/i2c/i2creg"
	"periph.io/x/host/v3"
	"time"
)

const (
	sht85Addr = 0x44 // Default I2C address for SHT85

	// Measurement commands
	cmdMeasureHighPrecision = 0x2400 // High precision measurement
	cmdSoftReset           = 0x30A2  // Soft reset command

	// CRC polynomial: x^8 + x^5 + x^4 + 1 = 100110001
	crcPolynomial = 0x31
)

type SHT85 struct {
	bus i2c.BusCloser
	dev i2c.Dev
}

func NewSHT85() (*SHT85, error) {
	// Initialize host
	if _, err := host.Init(); err != nil {
		return nil, fmt.Errorf("failed to initialize host: %v", err)
	}

	// Try to open each bus and find the device
	var lastErr error
	for _, busRef := range i2creg.All() {
		bus, err := i2creg.Open(busRef.Name)
		if err != nil {
			lastErr = err
			continue
		}

		dev := i2c.Dev{Bus: bus, Addr: sht85Addr}
		sht := &SHT85{
			bus: bus,
			dev: dev,
		}

		// Try to reset the device
		if err := sht.reset(); err != nil {
			bus.Close()
			lastErr = err
			continue
		}

		return sht, nil
	}

	return nil, fmt.Errorf("failed to initialize SHT85 on any bus: %v", lastErr)
}

func (s *SHT85) reset() error {
	cmd := make([]byte, 2)
	binary.BigEndian.PutUint16(cmd, cmdSoftReset)
	if err := s.dev.Tx(cmd, nil); err != nil {
		return fmt.Errorf("reset command failed: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	return nil
}

func calculateCRC8(data []byte) byte {
	crc := byte(0xFF)
	for _, b := range data {
		crc ^= b
		for i := 0; i < 8; i++ {
			if crc&0x80 != 0 {
				crc = (crc << 1) ^ crcPolynomial
			} else {
				crc = crc << 1
			}
		}
	}
	return crc
}

func (s *SHT85) ReadTemperatureHumidity() (float64, float64, error) {
	// Send measurement command
	cmd := make([]byte, 2)
	binary.BigEndian.PutUint16(cmd, cmdMeasureHighPrecision)
	if err := s.dev.Tx(cmd, nil); err != nil {
		return 0, 0, fmt.Errorf("failed to send measurement command: %v", err)
	}

	// Wait for measurement to complete (high precision takes about 15ms)
	time.Sleep(15 * time.Millisecond)

	// Read measurement data (6 bytes: temp MSB, temp LSB, temp CRC, hum MSB, hum LSB, hum CRC)
	buf := make([]byte, 6)
	if err := s.dev.Tx(nil, buf); err != nil {
		return 0, 0, fmt.Errorf("failed to read measurement: %v", err)
	}

	// Verify temperature CRC
	tempCRC := calculateCRC8(buf[0:2])
	if tempCRC != buf[2] {
		return 0, 0, fmt.Errorf("temperature CRC mismatch: calculated %02x, received %02x", tempCRC, buf[2])
	}

	// Verify humidity CRC
	humCRC := calculateCRC8(buf[3:5])
	if humCRC != buf[5] {
		return 0, 0, fmt.Errorf("humidity CRC mismatch: calculated %02x, received %02x", humCRC, buf[5])
	}

	// Convert raw temperature
	rawTemp := uint16(buf[0])<<8 | uint16(buf[1])
	temperature := float64(rawTemp)*175.0/65535.0 - 45.0

	// Convert raw humidity
	rawHumidity := uint16(buf[3])<<8 | uint16(buf[4])
	humidity := float64(rawHumidity) * 100.0 / 65535.0

	return temperature, humidity, nil
}

func (s *SHT85) ReadTemperature() (float64, error) {
	temp, _, err := s.ReadTemperatureHumidity()
	return temp, err
}

func (s *SHT85) ReadHumidity() (float64, error) {
	_, humidity, err := s.ReadTemperatureHumidity()
	return humidity, err
}

func (s *SHT85) Close() error {
	return s.bus.Close()
} 