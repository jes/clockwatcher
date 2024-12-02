package receiver

import (
	"encoding/binary"
	"periph.io/x/conn/v3/i2c"
	"periph.io/x/conn/v3/i2c/i2creg"
	"periph.io/x/host/v3"
	"time"
)

const (
	bmp180Addr = 0x77
	
	// Calibration registers
	calAC1 = 0xAA
	calAC2 = 0xAC
	calAC3 = 0xAE
	calAC4 = 0xB0
	calAC5 = 0xB2
	calAC6 = 0xB4
	calB1  = 0xB6
	calB2  = 0xB8
	calMB  = 0xBA
	calMC  = 0xBC
	calMD  = 0xBE

	// Control registers
	ctrlMeas = 0xF4
	tempCmd  = 0x2E
	pressCmd = 0x34

	// Data registers
	dataReg = 0xF6
)

type BMP180 struct {
	bus i2c.BusCloser
	dev i2c.Dev
	cal calibrationData
}

type calibrationData struct {
	ac1, ac2, ac3      int16
	ac4, ac5, ac6      uint16
	b1, b2             int16
	mb, mc, md         int16
}

func NewBMP180() (*BMP180, error) {
	// Initialize host
	if _, err := host.Init(); err != nil {
		return nil, err
	}

	// Open I2C bus
	bus, err := i2creg.Open("")
	if err != nil {
		return nil, err
	}

	dev := i2c.Dev{Bus: bus, Addr: bmp180Addr}
	
	bmp := &BMP180{
		bus: bus,
		dev: dev,
	}

	// Read calibration data
	if err := bmp.readCalibrationData(); err != nil {
		bus.Close()
		return nil, err
	}

	return bmp, nil
}

func (b *BMP180) readCalibrationData() error {
	buf := make([]byte, 22)
	if err := b.dev.Tx([]byte{calAC1}, buf); err != nil {
		return err
	}

	b.cal.ac1 = int16(binary.BigEndian.Uint16(buf[0:2]))
	b.cal.ac2 = int16(binary.BigEndian.Uint16(buf[2:4]))
	b.cal.ac3 = int16(binary.BigEndian.Uint16(buf[4:6]))
	b.cal.ac4 = binary.BigEndian.Uint16(buf[6:8])
	b.cal.ac5 = binary.BigEndian.Uint16(buf[8:10])
	b.cal.ac6 = binary.BigEndian.Uint16(buf[10:12])
	b.cal.b1 = int16(binary.BigEndian.Uint16(buf[12:14]))
	b.cal.b2 = int16(binary.BigEndian.Uint16(buf[14:16]))
	b.cal.mb = int16(binary.BigEndian.Uint16(buf[16:18]))
	b.cal.mc = int16(binary.BigEndian.Uint16(buf[18:20]))
	b.cal.md = int16(binary.BigEndian.Uint16(buf[20:22]))

	return nil
}

func (b *BMP180) ReadTemperature() (float64, error) {
	// Start temperature measurement
	if err := b.dev.Tx([]byte{ctrlMeas, tempCmd}, nil); err != nil {
		return 0, err
	}

	// Wait for measurement
	time.Sleep(5 * time.Millisecond)

	// Read raw temperature
	buf := make([]byte, 2)
	if err := b.dev.Tx([]byte{dataReg}, buf); err != nil {
		return 0, err
	}

	rawTemp := int32(binary.BigEndian.Uint16(buf))

	// Calculate true temperature
	x1 := ((rawTemp - int32(b.cal.ac6)) * int32(b.cal.ac5)) >> 15
	x2 := (int32(b.cal.mc) << 11) / (x1 + int32(b.cal.md))
	bf := (x1 + x2 + 8) >> 4

	// Convert to degrees Celsius
	return float64(bf) / 10.0, nil
}

func (b *BMP180) ReadPressure() (float64, error) {
	// Start temperature measurement (needed for pressure calculation)
	if err := b.dev.Tx([]byte{ctrlMeas, tempCmd}, nil); err != nil {
		return 0, err
	}
	time.Sleep(5 * time.Millisecond)

	// Read raw temperature
	buf := make([]byte, 2)
	if err := b.dev.Tx([]byte{dataReg}, buf); err != nil {
		return 0, err
	}
	rawTemp := int32(binary.BigEndian.Uint16(buf))

	// Calculate temperature compensation
	x1 := ((rawTemp - int32(b.cal.ac6)) * int32(b.cal.ac5)) >> 15
	x2 := (int32(b.cal.mc) << 11) / (x1 + int32(b.cal.md))
	b5 := x1 + x2

	// Start pressure measurement (OSS = 0 for this example)
	if err := b.dev.Tx([]byte{ctrlMeas, pressCmd}, nil); err != nil {
		return 0, err
	}
	time.Sleep(5 * time.Millisecond)

	// Read raw pressure
	if err := b.dev.Tx([]byte{dataReg}, buf); err != nil {
		return 0, err
	}
	rawPress := int32(binary.BigEndian.Uint16(buf))

	// Calculate true pressure
	b6 := b5 - 4000
	x1 = (int32(b.cal.b2) * (b6 * b6 >> 12)) >> 11
	x2 = (int32(b.cal.ac2) * b6) >> 11
	x3 := x1 + x2
	b3 := (((int32(b.cal.ac1)*4 + x3) << 0) + 2) >> 2

	x1 = (int32(b.cal.ac3) * b6) >> 13
	x2 = (int32(b.cal.b1) * ((b6 * b6) >> 12)) >> 16
	x3 = ((x1 + x2) + 2) >> 2
	b4 := (uint32(b.cal.ac4) * uint32(x3+32768)) >> 15
	b7 := uint32(rawPress-b3) * (50000 >> 0)

	var p int32
	if b7 < 0x80000000 {
		p = int32((b7 * 2) / b4)
	} else {
		p = int32((b7 / b4) * 2)
	}

	x1 = (p >> 8) * (p >> 8)
	x1 = (x1 * 3038) >> 16
	x2 = (-7357 * p) >> 16

	// Convert to hPa (hectopascals)
	return float64(p+((x1+x2+3791)>>4)) / 100.0, nil
}

func (b *BMP180) Close() error {
	return b.bus.Close()
}
