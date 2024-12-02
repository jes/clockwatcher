package main

import (
	"fmt"
	"log"
	"time"
	"receiver"
)

func main() {
	bmp, err := receiver.NewBMP180()
	if err != nil {
		log.Fatal(err)
	}
	defer bmp.Close()

	for {
		temp, err := bmp.ReadTemperature()
		if err != nil {
			log.Printf("Error reading temperature: %v", err)
			continue
		}

		pressure, err := bmp.ReadPressure()
		if err != nil {
			log.Printf("Error reading pressure: %v", err)
			continue
		}

		fmt.Printf("Temperature: %.2f°C, Pressure: %.2f hPa\n", temp, pressure)
		time.Sleep(2 * time.Second)
	}
}
