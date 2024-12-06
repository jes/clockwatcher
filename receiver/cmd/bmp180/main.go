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

	// Print CSV header
	fmt.Println("timestamp,temperature,pressure")

	for {
		temp, pressure, err := bmp.ReadTemperaturePressure()
		if err != nil {
			log.Printf("Error reading temperature: %v", err)
			continue
		}

		// Output in CSV format with RFC3339 timestamp
		fmt.Printf("%s,%.2f,%.2f\n", 
			time.Now().Format(time.RFC3339),
			temp,
			pressure)
			
		time.Sleep(2 * time.Second)
	}
}
