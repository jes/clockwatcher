// derived from https://github.com/adafruit/Adafruit_CircuitPython_BMP3XX

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
	bmp390Addr = 0x76

	// Registers
	regChipId        = 0x00
	regStatus        = 0x03
	regPressureData  = 0x04
	regTempData      = 0x07
	regControl       = 0x1B
	regOsr           = 0x1C
	regOdr           = 0x1D
	regConfig        = 0x1F
	regCalData       = 0x31
	regCmd           = 0x7E

	// Chip IDs
	chipIdBMP388 = 0x50
	chipIdBMP390 = 0x60
)

type BMP390 struct {
	bus i2c.BusCloser
	dev i2c.Dev
	cal calibrationCoefficients
}

type calibrationCoefficients struct {
	tempCal  [3]float64  // T1, T2, T3
	pressCal [11]float64 // P1 through P11
}

func NewBMP390() (*BMP390, error) {
	if _, err := host.Init(); err != nil {
		return nil, err
	}

	bus, err := i2creg.Open("")
	if err != nil {
		return nil, err
	}

	dev := i2c.Dev{Bus: bus, Addr: bmp390Addr}
	
	bmp := &BMP390{
		bus: bus,
		dev: dev,
	}

	// Verify chip ID
	chipID, err := bmp.readByte(regChipId)
	if err != nil {
		bus.Close()
		return nil, err
	}
	if chipID != chipIdBMP388 && chipID != chipIdBMP390 {
		bus.Close()
		return nil, fmt.Errorf("unexpected chip ID: %#x", chipID)
	}

	// Read calibration data
	if err := bmp.readCalibrationData(); err != nil {
		bus.Close()
		return nil, err
	}

	// Reset device
	if err := bmp.reset(); err != nil {
		bus.Close()
		return nil, err
	}

	return bmp, nil
}

func (b *BMP390) readCalibrationData() error {
	buf := make([]byte, 21)
	if err := b.dev.Tx([]byte{regCalData}, buf); err != nil {
		return err
	}

	// Match Python's struct.unpack("<HHbhhbbHHbbhbb", coeff)
	// < means little endian
	// H = uint16, h = int16, b = int8
	var (
		t1 uint16  // H
		t2 uint16  // H
		t3 int8    // b
		p1 int16   // h
		p2 int16   // h
		p3 int8    // b
		p4 int8    // b
		p5 uint16  // H
		p6 uint16  // H
		p7 int8    // b
		p8 int8    // b
		p9 int16   // h
		p10 int8   // b
		p11 int8   // b
	)

	// Unpack using little endian as specified in Python
	t1 = binary.LittleEndian.Uint16(buf[0:2])
	t2 = binary.LittleEndian.Uint16(buf[2:4])
	t3 = int8(buf[4])
	p1 = int16(binary.LittleEndian.Uint16(buf[5:7]))
	p2 = int16(binary.LittleEndian.Uint16(buf[7:9]))
	p3 = int8(buf[9])
	p4 = int8(buf[10])
	p5 = binary.LittleEndian.Uint16(buf[11:13])
	p6 = binary.LittleEndian.Uint16(buf[13:15])
	p7 = int8(buf[15])
	p8 = int8(buf[16])
	p9 = int16(binary.LittleEndian.Uint16(buf[17:19]))
	p10 = int8(buf[19])
	p11 = int8(buf[20])

	// Match Python's calibration calculations exactly
	b.cal.tempCal[0] = float64(t1) * 256.0    // T1
	b.cal.tempCal[1] = float64(t2) / float64(1 << 30) // T2
	b.cal.tempCal[2] = float64(t3) / float64(1 << 48) // T3

	b.cal.pressCal[0] = (float64(p1) - float64(1<<14)) / float64(1<<20)  // P1
	b.cal.pressCal[1] = (float64(p2) - float64(1<<14)) / float64(1<<29)  // P2
	b.cal.pressCal[2] = float64(p3) / float64(1<<32)  // P3
	b.cal.pressCal[3] = float64(p4) / float64(1<<37)  // P4
	b.cal.pressCal[4] = float64(p5) * 8.0      // P5
	b.cal.pressCal[5] = float64(p6) / float64(1<<6)   // P6
	b.cal.pressCal[6] = float64(p7) / float64(1<<8)   // P7
	b.cal.pressCal[7] = float64(p8) / float64(1<<15)  // P8
	b.cal.pressCal[8] = float64(p9) / float64(1<<48)  // P9
	b.cal.pressCal[9] = float64(p10) / float64(1<<48) // P10
	b.cal.pressCal[10] = float64(p11) / float64(1<<65) // P11

	return nil
}

func (b *BMP390) ReadTemperaturePressure() (float64, float64, error) {
	// Start measurement in forced mode
	if err := b.dev.Tx([]byte{regControl, 0x13}, nil); err != nil {
		return 0, 0, err
	}

	// Wait for measurement to complete with timeout, using Python's wait time
	for start := time.Now(); time.Since(start) < 100*time.Millisecond; {
		status, err := b.readByte(regStatus)
		if err != nil {
			return 0, 0, err
		}
		if status&0x60 == 0x60 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}

	// Read pressure and temperature data
	buf := make([]byte, 6)
	if err := b.dev.Tx([]byte{regPressureData}, buf); err != nil {
		return 0, 0, err
	}

	// Convert readings exactly as Python does
	rawPress := uint32(buf[2])<<16 | uint32(buf[1])<<8 | uint32(buf[0])
	rawTemp := uint32(buf[5])<<16 | uint32(buf[4])<<8 | uint32(buf[3])

	// Calculate temperature using Python's method
	pd1 := float64(rawTemp) - b.cal.tempCal[0]
	pd2 := pd1 * b.cal.tempCal[1]
	temperature := pd2 + (pd1 * pd1) * b.cal.tempCal[2]

	// Calculate pressure using Python's method
	pd1 = b.cal.pressCal[5] * temperature
	pd2 = b.cal.pressCal[6] * temperature * temperature
	pd3 := b.cal.pressCal[7] * temperature * temperature * temperature
	po1 := b.cal.pressCal[4] + pd1 + pd2 + pd3

	pd1 = b.cal.pressCal[1] * temperature
	pd2 = b.cal.pressCal[2] * temperature * temperature
	pd3 = b.cal.pressCal[3] * temperature * temperature * temperature
	po2 := float64(rawPress) * (b.cal.pressCal[0] + pd1 + pd2 + pd3)

	pd1 = float64(rawPress) * float64(rawPress)
	pd2 = b.cal.pressCal[8] + b.cal.pressCal[9]*temperature
	pd3 = pd1 * pd2
	pd4 := pd3+b.cal.pressCal[10]*float64(rawPress)*float64(rawPress)*float64(rawPress)

	pressure := po1 + po2 + pd4

	// Convert pressure to hPa
	pressure /= 100.0

	return temperature, pressure, nil
}

func (b *BMP390) reset() error {
	return b.dev.Tx([]byte{regCmd, 0xB6}, nil)
}

func (b *BMP390) readByte(reg byte) (byte, error) {
	buf := make([]byte, 1)
	if err := b.dev.Tx([]byte{reg}, buf); err != nil {
		return 0, err
	}
	return buf[0], nil
}

func (b *BMP390) Close() error {
	return b.bus.Close()
}
