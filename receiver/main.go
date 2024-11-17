package main

import (
	"flag"
	"log"
	"os"

	"go.bug.st/serial"
)

func main() {
	portName := flag.String("port", "/dev/ttyUSB0", "Serial port name")
	baudRate := flag.Int("baud", 115200, "Baud rate")
	flag.Parse()

	mode := &serial.Mode{BaudRate: *baudRate}
	port, err := serial.Open(*portName, mode)
	if err != nil {
		log.Fatalf("Failed to open serial port: %v", err)
	}
	defer port.Close()

	// Create channel for readings
	readings := make(chan Reading)

	// Create and start serial reader
	reader := NewSerialReader(port)
	go func() {
		if err := reader.StartReading(readings); err != nil {
			log.Fatalf("Error reading from serial port: %v", err)
		}
	}()

	// Create and start CSV writer
	csvWriter := NewCSVWriter(os.Stdout)
	defer csvWriter.Close()

	// Start processing readings
	if err := csvWriter.Start(readings); err != nil {
		log.Fatalf("Error writing CSV: %v", err)
	}
}
