package receiver

import (
	"database/sql"
	"time"
	_ "github.com/mattn/go-sqlite3"
	"math"
)

type DataPoint struct {
	TotalMicros       uint64
	TimestampDrift    int64
	Amplitude         float64
	Period            float64
	BMP180Temperature float64
	BMP180Pressure    float64
	SHT85Temperature  float64
	SHT85Humidity     float64
}

type DataRecorder struct {
	db                *sql.DB
	readings          []Reading    // Circular buffer for recent readings
	maxReadings       int          // Size of circular buffer
	currentIndex      int          // Current position in circular buffer
	lastPositivePeak  *Peak
	lastNegativePeak  *Peak
	lastZeroCrossing  *ZeroCrossing
	lastBMP180        *BMP180Reading
	lastSHT85         *SHT85Reading
	positiveHalfPeriod float64
	negativeHalfPeriod float64
}

type Peak struct {
	Time     int64   // TotalMicros when peak occurred
	Position float64 // Value at peak
}

type ZeroCrossing struct {
	Time  int64
	IsPositiveGoing bool
}

func NewDataRecorder() (*DataRecorder, error) {
	db, err := sql.Open("sqlite3", "readings.db")
	if err != nil {
		return nil, err
	}

	// Create table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS readings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp INTEGER,
			total_micros INTEGER,
			timestamp_drift INTEGER,
			amplitude REAL,
			period REAL,
			bmp180_temperature REAL,
			bmp180_pressure REAL,
			sht85_temperature REAL,
			sht85_humidity REAL
		)
	`)
	if err != nil {
		return nil, err
	}

	return &DataRecorder{
		db:          db,
		readings:    make([]Reading, 1000), // Keep last 1000 readings for analysis
		maxReadings: 1000,
	}, nil
}

func (dr *DataRecorder) Close() error {
	return dr.db.Close()
}

// AddReading processes a new reading and updates peaks/crossings
func (dr *DataRecorder) AddReading(reading Reading) {
	// Store reading in circular buffer
	dr.readings[dr.currentIndex] = reading
	dr.currentIndex = (dr.currentIndex + 1) % dr.maxReadings

	// Get previous reading for comparison
	prevIndex := (dr.currentIndex - 2 + dr.maxReadings) % dr.maxReadings
	prevReading := dr.readings[prevIndex]

	// Detect zero crossings and peaks
	newCrossing := dr.detectZeroCrossings(reading, prevReading)
	dr.detectPeaks()

	// If we just had a new zero crossing and have all the data, write to database
	if newCrossing {
		dr.writeToDatabase()
	}
}

func (dr *DataRecorder) UpdateBMP180(reading BMP180Reading) {
	dr.lastBMP180 = &reading
}

func (dr *DataRecorder) UpdateSHT85(reading SHT85Reading) {
	dr.lastSHT85 = &reading
}

// detectZeroCrossings checks for zero crossings in the signal
// Returns true if a new zero crossing was detected
func (dr *DataRecorder) detectZeroCrossings(reading, prevReading Reading) bool {
	// Convert counts to degrees
	current := float64(reading.Count) * 2
	prev := float64(prevReading.Count) * 2
	currentTime := int64(reading.TotalMicros)

	// Require at least 100ms between zero crossings to avoid noise
	if dr.lastZeroCrossing != nil && (currentTime-dr.lastZeroCrossing.Time) < 100000 {
		return false
	}

	if prev <= 0 && current > 0 {
		// Positive-going zero crossing
		if dr.lastZeroCrossing != nil {
			dr.positiveHalfPeriod = float64(currentTime-dr.lastZeroCrossing.Time) / 1000000.0 // Convert to seconds
		}
		dr.lastZeroCrossing = &ZeroCrossing{Time: currentTime, IsPositiveGoing: true}
		return true
	} else if prev >= 0 && current < 0 {
		// Negative-going zero crossing
		if dr.lastZeroCrossing != nil {
			dr.negativeHalfPeriod = float64(currentTime-dr.lastZeroCrossing.Time) / 1000000.0 // Convert to seconds
		}
		dr.lastZeroCrossing = &ZeroCrossing{Time: currentTime, IsPositiveGoing: false}
		return true
	}

	return false
}

// detectPeaks uses quadratic interpolation to find precise peak locations
func (dr *DataRecorder) detectPeaks() {
	// Need at least 3 points for quadratic interpolation
	if dr.currentIndex < 3 {
		return
	}

	// Get the last three points
	idx1 := (dr.currentIndex - 3 + dr.maxReadings) % dr.maxReadings
	idx2 := (dr.currentIndex - 2 + dr.maxReadings) % dr.maxReadings
	idx3 := (dr.currentIndex - 1 + dr.maxReadings) % dr.maxReadings

	p1 := float64(dr.readings[idx1].Count) * 2
	p2 := float64(dr.readings[idx2].Count) * 2
	p3 := float64(dr.readings[idx3].Count) * 2

	t1 := float64(dr.readings[idx1].TotalMicros)
	t2 := float64(dr.readings[idx2].TotalMicros)
	t3 := float64(dr.readings[idx3].TotalMicros)

	// Detect positive peak
	if p2 > p1 && p2 > p3 && p2 > 0 {
		// Add 2 degrees to p3 to account for quantization
		if peak := dr.interpolatePeak(p1, p2, p3+2, t1, t2, t3); peak != nil {
			dr.lastPositivePeak = peak
		}
	}
	// Detect negative peak
	if p2 < p1 && p2 < p3 && p2 < 0 {
		// Add 2 degrees to p1 and p2 to account for quantization
		if peak := dr.interpolatePeak(p1+2, p2+2, p3, t1, t2, t3); peak != nil {
			dr.lastNegativePeak = peak
		}
	}
}

// interpolatePeak performs quadratic interpolation to find precise peak location
func (dr *DataRecorder) interpolatePeak(p1, p2, p3, t1, t2, t3 float64) *Peak {
	// Convert time points to relative coordinates
	t0 := t2 // Use middle point as reference
	x1 := t1 - t0
	x2 := 0.0 // t2 - t0 = 0
	x3 := t3 - t0

	// Solve quadratic equation y = ax² + bx + c
	denom := (x1-x2)*(x1-x3)*(x2-x3)
	a := (x3*(p2-p1) + x2*(p1-p3) + x1*(p3-p2)) / denom
	b := (x3*x3*(p1-p2) + x2*x2*(p3-p1) + x1*x1*(p2-p3)) / denom

	// Peak occurs at x = -b/(2a)
	xPeak := -b / (2 * a)
	tPeak := xPeak + t0

	// Calculate peak position
	pPeak := a*xPeak*xPeak + b*xPeak + p2

	// Only return result if peak is within the time interval
	// and if the interpolated peak is within 4 units of the middle value
	if tPeak >= t1 && tPeak <= t3 && math.Abs(pPeak-p2) <= 4 {
		return &Peak{
			Time:     int64(tPeak),
			Position: pPeak,
		}
	}

	return nil
}

func (dr *DataRecorder) writeToDatabase() error {
	// Check if we have all the data we need
	if dr.lastZeroCrossing == nil ||
		dr.lastPositivePeak == nil ||
		dr.lastNegativePeak == nil ||
		dr.positiveHalfPeriod <= 0 ||
		dr.negativeHalfPeriod <= 0 {
		return nil
	}

	period := dr.positiveHalfPeriod + dr.negativeHalfPeriod
	amplitude := dr.lastPositivePeak.Position - dr.lastNegativePeak.Position

	var bmpTemp, bmpPressure, shtTemp, shtHumidity float64
	if dr.lastBMP180 != nil {
		bmpTemp = dr.lastBMP180.Temperature
		bmpPressure = dr.lastBMP180.Pressure
	}
	if dr.lastSHT85 != nil {
		shtTemp = dr.lastSHT85.Temperature
		shtHumidity = dr.lastSHT85.Humidity
	}

	_, err := dr.db.Exec(`
		INSERT INTO readings (
			timestamp,
			total_micros,
			timestamp_drift,
			amplitude,
			period,
			bmp180_temperature,
			bmp180_pressure,
			sht85_temperature,
			sht85_humidity
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		time.Now().Unix(),
		dr.readings[dr.currentIndex-1].TotalMicros,
		dr.readings[dr.currentIndex-1].TimestampDrift,
		amplitude,
		period,
		bmpTemp,
		bmpPressure,
		shtTemp,
		shtHumidity,
	)

	return err
}