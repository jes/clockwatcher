package main

import (
	"encoding/csv"
	"fmt"
	"io"
)

type CSVWriter struct {
	writer *csv.Writer
}

func NewCSVWriter(w io.Writer) *CSVWriter {
	return &CSVWriter{
		writer: csv.NewWriter(w),
	}
}

func (cw *CSVWriter) Start(readings <-chan Reading) error {
	// Write CSV header
	if err := cw.writer.Write([]string{"Timestamp_us", "Count"}); err != nil {
		return fmt.Errorf("error writing CSV header: %v", err)
	}

	// Process readings using WriteReading
	for reading := range readings {
		if err := cw.WriteReading(reading); err != nil {
			return err
		}
	}

	return nil
}

func (cw *CSVWriter) Close() {
	cw.writer.Flush()
}

func (cw *CSVWriter) WriteReading(reading Reading) error {
	if err := cw.writer.Write([]string{
		fmt.Sprintf("%d", reading.TotalMicros),
		fmt.Sprintf("%d", reading.Count),
	}); err != nil {
		return fmt.Errorf("error writing CSV: %v", err)
	}
	cw.writer.Flush()
	return nil
}
