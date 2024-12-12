package main

import (
	"fmt"
	"log"
	"time"
	"receiver"
)

func main() {
	bmp, err := receiver.NewBMP390()
	if err != nil {
		log.Fatal(err)
	}
	defer bmp.Close()

	for {
		temp, pressure, err := bmp.ReadTemperaturePressure()
		if err != nil {
			log.Printf("Error reading temperature and pressure: %v", err)
			continue
		}

		fmt.Printf("Temperature: %.2f°C, Pressure: %.2f hPa\n", temp, pressure)
		time.Sleep(2 * time.Second)
	}
}
