class DataRecorder {
    constructor() {
        this.tareOffset = 0;
        this.mode = 'live';
        this.reset();
    }

    reset() {
        this.maxPoints = 10000;
        this.timestamps = [];
        this.timeOffset = null;
        this.counts = [];
        this.timestampDrifts = [];
        this.timestampDriftRates = [];
        this.velocities = [];
        this.accelerations = [];
        this.smoothingWindow = 20;
        
        // Peak and crossing detection
        this.lastPositivePeak = null;
        this.lastNegativePeak = null;
        this.lastZeroCrossing = null;
        this.lastPositiveHalfperiod = null;
        this.lastNegativeHalfperiod = null;
        this.previousCount = null;
        
        // Measurement arrays
        this.periodData = [];
        this.amplitudeData = [];
        this.periodTimestamps = [];
        this.amplitudeTimestamps = [];
        this.amplitudeRateData = [];
        this.amplitudeRateTimestamps = [];
        
        // BMP180 sensor data
        this.bmp180Temperatures = [];
        this.bmp180Pressures = [];
        this.bmp180Timestamps = [];

        // BMP390 sensor data
        this.bmp390Temperatures = [];
        this.bmp390Pressures = [];
        this.bmp390Timestamps = [];

        // SHT85 sensor data
        this.sht85Temperatures = [];
        this.sht85Humidities = [];
        this.sht85Timestamps = [];

        // Add new array for temperatures sampled at period/amplitude points
        this.sampledBMP390Temperatures = [];
    }

    tare() {
        if (this.counts.length === 0) return;
        const sub = this.counts[this.counts.length - 1];
        this.counts = this.counts.map(count => count - sub);
        this.tareOffset += sub;
    }

    getCurrentPosition() {
        return this.counts[this.counts.length - 1] || 0;
    }
    getCurrentTimestampDrift() {
        return this.timestampDrifts[this.timestampDrifts.length - 1] || 0;
    }
    getCurrentVelocity() {
        return this.velocities[this.velocities.length - 1] || 0;
    }
    getCurrentAcceleration() {
        return this.accelerations[this.accelerations.length - 1] || 0;
    }
    getCurrentPeriod() {
        return this.periodData[this.periodData.length - 1] || 0;
    }
    getPositiveHalfperiod() {
        return this.lastPositiveHalfperiod || 0;
    }
    getNegativeHalfperiod() {
        return this.lastNegativeHalfperiod || 0;
    }
    getCurrentAmplitude() {
        return this.lastPositivePeak - this.lastNegativePeak || 0;
    }
    getPositiveAmplitude() {
        return this.lastPositivePeak || 0;
    }
    getNegativeAmplitude() {
        return this.lastNegativePeak || 0;
    }

    getCurrentBMP180Temperature() {
        return this.bmp180Temperatures[this.bmp180Temperatures.length - 1] || 0;
    }

    getCurrentBMP180Pressure() {
        return this.bmp180Pressures[this.bmp180Pressures.length - 1] || 0;
    }

    getCurrentBMP390Temperature() {
        return this.bmp390Temperatures[this.bmp390Temperatures.length - 1] || 0;
    }

    getCurrentBMP390Pressure() {
        return this.bmp390Pressures[this.bmp390Pressures.length - 1] || 0;
    }

    getCurrentSHT85Temperature() {
        return this.sht85Temperatures[this.sht85Temperatures.length - 1] || 0;
    }

    getCurrentSHT85Humidity() {
        return this.sht85Humidities[this.sht85Humidities.length - 1] || 0;
    }

    getCurrentTimestampDriftRate() {
        return this.timestampDriftRates[this.timestampDriftRates.length - 1] || 0;
    }

    addReading(message) {
        if (this.mode !== 'live') {
            return null;
        }
        if (this.timeOffset == null) {
            this.timeOffset = message.TotalMicros / 1000000;
        }

        const timeSeconds = (message.TotalMicros / 1000000) - this.timeOffset;
        const degrees = (message.Count * 2) - this.tareOffset;

        this.timestamps.push(timeSeconds);
        this.timestampDrifts.push(message.TimestampDrift);
        
        if (this.timestampDrifts.length > 100) {
            const ts0 = this.timestamps[this.timestamps.length - 99] * 1000000;
            const ts1 = this.timestamps[this.timestamps.length - 1] * 1000000;

            const esp_ts0 = this.timestampDrifts[this.timestampDrifts.length - 99] + ts0;
            const esp_ts1 = this.timestampDrifts[this.timestampDrifts.length - 1] + ts1;

            // Calculate instantaneous drift rate
            const instantDriftRate = ((esp_ts1 - esp_ts0) / (ts1 - ts0) - 1.0) * 1000000;

            // exponential moving average
            const currentDriftRate = this.timestampDriftRates[this.timestampDriftRates.length - 1] || 0.0;
            const k = 0.001;
            const smoothedDriftRate = (k * instantDriftRate) + ((1 - k) * currentDriftRate);
            
            this.timestampDriftRates.push(smoothedDriftRate);
        }
        
        this.counts.push(degrees || 0);
        
        this.detectCrossingsAndPeaks();
        
        const currentVelocity = this.calculateVelocity();
        this.velocities.push(currentVelocity);

        const acceleration = this.calculateAcceleration();
        this.accelerations.push(acceleration);

        this.trimArrays();
        
        return {
            position: degrees,
            velocity: currentVelocity,
            acceleration: acceleration
        };
    }

    addBMP180Reading(message) {
        if (this.mode !== 'live') {
            return;
        }
        if (message.type !== 'BMP180') return;
        
        if (this.timeOffset == null) {
            this.timeOffset = message.timestamp / 1000000;
        }
        const timeSeconds = (message.timestamp / 1000000) - this.timeOffset;

        this.bmp180Temperatures.push(message.temperature);
        this.bmp180Pressures.push(message.pressure);
        this.bmp180Timestamps.push(timeSeconds);

        // Keep arrays at maxPoints length
        if (this.bmp180Temperatures.length > this.maxPoints) {
            this.bmp180Temperatures = this.bmp180Temperatures.slice(-this.maxPoints);
            this.bmp180Pressures = this.bmp180Pressures.slice(-this.maxPoints);
            this.bmp180Timestamps = this.bmp180Timestamps.slice(-this.maxPoints);
        }
    }

    addBMP390Reading(message) {
        if (this.mode !== 'live') {
            return;
        }
        if (message.type !== 'BMP390') return;

        if (this.timeOffset == null) {
            this.timeOffset = message.timestamp / 1000000;
        }
        const timeSeconds = (message.timestamp / 1000000) - this.timeOffset;

        this.bmp390Temperatures.push(message.temperature);
        this.bmp390Pressures.push(message.pressure);
        this.bmp390Timestamps.push(timeSeconds);

        // Keep arrays at maxPoints length
        if (this.bmp390Temperatures.length > this.maxPoints) {
            this.bmp390Temperatures = this.bmp390Temperatures.slice(-this.maxPoints);
            this.bmp390Pressures = this.bmp390Pressures.slice(-this.maxPoints);
            this.bmp390Timestamps = this.bmp390Timestamps.slice(-this.maxPoints);
        }
    }

    addSHT85Reading(message) {
        if (this.mode !== 'live') {
            return;
        }
        if (message.type !== 'SHT85') return;
        
        if (this.timeOffset == null) {
            this.timeOffset = message.timestamp / 1000000;
        }
        const timeSeconds = (message.timestamp / 1000000) - this.timeOffset;

        this.sht85Temperatures.push(message.temperature);
        this.sht85Humidities.push(message.humidity);
        this.sht85Timestamps.push(timeSeconds);

        // Keep arrays at maxPoints length
        if (this.sht85Temperatures.length > this.maxPoints) {
            this.sht85Temperatures = this.sht85Temperatures.slice(-this.maxPoints);
            this.sht85Humidities = this.sht85Humidities.slice(-this.maxPoints);
            this.sht85Timestamps = this.sht85Timestamps.slice(-this.maxPoints);
        }
    }

    calculateFiniteDifference(array, step) {
        if (array.length < step + 1) return 0;
        
        // Use the most recent point and a point 'step' positions back
        const dt = this.timestamps[this.timestamps.length - 1] - 
                  this.timestamps[this.timestamps.length - step];
        const dy = array[array.length - 1] - 
                  array[array.length - step];
        
        return dy / dt;
    }

    calculateVelocity() {
        return this.calculateFiniteDifference(this.counts, 10);
    }

    calculateAcceleration() {
        return this.calculateFiniteDifference(this.velocities, 10);
    }

    detectCrossingsAndPeaks() {
        const n = this.counts.length;
        if (n < 2) return;

        const current = this.counts[n - 1];
        const prev = this.counts[n - 2];
        const currentTime = this.timestamps[n - 1];

        this.detectZeroCrossings(current, prev, currentTime);
        this.detectPeaks(n);
    }

    updatePeriod() {
        if (this.lastPositiveHalfperiod == null || this.lastNegativeHalfperiod == null
            || this.lastPositivePeak == null || this.lastNegativePeak == null) {
            return;
        }

        const period = this.lastPositiveHalfperiod + this.lastNegativeHalfperiod;
        const amplitude = this.lastPositivePeak - this.lastNegativePeak;
        const currentTime = this.timestamps[this.timestamps.length - 1];
        
        // Get the current temperature
        const currentTemp = this.getCurrentBMP390Temperature();
        
        this.periodData.push(period);
        this.periodTimestamps.push(currentTime);
        
        // Calculate rate of change of amplitude
        if (this.amplitudeData.length > 1) {
            const deltaAmplitude = amplitude - this.amplitudeData[this.amplitudeData.length - 1];
            const deltaTime = currentTime - this.amplitudeTimestamps[this.amplitudeTimestamps.length - 1];
            const amplitudeRate = deltaAmplitude / deltaTime;
            
            this.amplitudeRateData.push(amplitudeRate);
            this.amplitudeRateTimestamps.push(currentTime);
        }

        this.amplitudeData.push(amplitude);
        this.amplitudeTimestamps.push(currentTime);
        
        // Store temperature at the same sampling points as period/amplitude
        this.sampledBMP390Temperatures.push(currentTemp);
    }

    detectZeroCrossings(current, prev, currentTime) {
        const timeSinceLastZeroCrossing = currentTime - this.lastZeroCrossing;
        
        if (prev !== null && current !== null && timeSinceLastZeroCrossing > 0.1) {
            // Positive-going zero crossing
            if (prev <= 0 && current > 0) {
                if (this.lastZeroCrossing !== null) {
                    this.lastPositiveHalfperiod = currentTime - this.lastZeroCrossing;
                    this.updatePeriod();
                }
                this.lastZeroCrossing = currentTime;
            }
            // Negative-going zero crossing
            else if (prev >= 0 && current < 0) {
                if (this.lastZeroCrossing !== null) {
                    this.lastNegativeHalfperiod = currentTime - this.lastZeroCrossing;
                    this.updatePeriod();
                }
                this.lastZeroCrossing = currentTime;
            }
        }
    }

    detectPeaks(n) {
        if (n < 3) return;
        
        const middlePoint = this.counts[n - 2];
        const prevPoint = this.counts[n - 3];
        const currentPoint = this.counts[n - 1];
        const middleTime = this.timestamps[n - 2];
        const prevTime = this.timestamps[n - 3];
        const currentTime = this.timestamps[n - 1];
        
        let amplitudeUpdated = false;

        // Detect positive peak
        if (middlePoint > prevPoint && middlePoint > currentPoint && middlePoint > 0) {
            // For positive peak, add 2 degrees to currentPoint because we were likely
            // exactly at the higher quantization level when we started dropping
            const interpolated = this.interpolatePeak(
                prevPoint, 
                middlePoint, 
                currentPoint + 2, 
                prevTime, 
                middleTime, 
                currentTime,
            );
            this.lastPositivePeak = interpolated ? interpolated.position : middlePoint;
            amplitudeUpdated = true;
        }
        // Detect negative peak
        else if (middlePoint < prevPoint && middlePoint < currentPoint && middlePoint < 0) {
            // For negative peak, add 2 degrees to prevPoint and middlePoint because
            // they were likely exactly at the lower quantization level
            const interpolated = this.interpolatePeak(
                prevPoint + 2, 
                middlePoint + 2, 
                currentPoint, 
                prevTime, 
                middleTime, 
                currentTime,
            );
            this.lastNegativePeak = interpolated ? interpolated.position : middlePoint;
            amplitudeUpdated = true;
        }
    }

    interpolatePeak(p1, p2, p3, t1, t2, t3) {
        // Convert time points to relative coordinates to improve numerical stability
        const t0 = t2;  // Use middle point as reference
        const x1 = t1 - t0;
        const x2 = 0;   // t2 - t0 = 0
        const x3 = t3 - t0;

        // Solve quadratic equation y = ax² + bx + c
        const denom = (x1 - x2) * (x1 - x3) * (x2 - x3);
        const a = (x3 * (p2 - p1) + x2 * (p1 - p3) + x1 * (p3 - p2)) / denom;
        const b = (x3*x3 * (p1 - p2) + x2*x2 * (p3 - p1) + x1*x1 * (p2 - p3)) / denom;
        
        // Peak occurs at x = -b/(2a)
        const xPeak = -b / (2 * a);
        
        // Convert back to absolute time
        const tPeak = xPeak + t0;
        
        // Calculate peak position using quadratic formula
        const pPeak = a * xPeak * xPeak + b * xPeak + p2;
        
        // Only return result if peak is within the time interval AND
        // if the interpolated peak is within 4 units of the middle value
        if (tPeak >= t1 && tPeak <= t3 && Math.abs(pPeak - p2) <= 4) {
            return { time: tPeak, position: pPeak };
        }
        
        // Return null if peak is outside the interval or too far from middle value
        return null;
    }

    trimArrays() {
        this.timestamps = this.timestamps.slice(-this.maxPoints);
        this.counts = this.counts.slice(-this.maxPoints);
        this.timestampDrifts = this.timestampDrifts.slice(-this.maxPoints);
        this.timestampDriftRates = this.timestampDriftRates.slice(-this.maxPoints);
        this.velocities = this.velocities.slice(-this.maxPoints);
        this.accelerations = this.accelerations.slice(-this.maxPoints);
        this.amplitudeData = this.amplitudeData.slice(-this.maxPoints);
        this.amplitudeTimestamps = this.amplitudeTimestamps.slice(-this.maxPoints);
        this.amplitudeRateData = this.amplitudeRateData.slice(-this.maxPoints);
        this.amplitudeRateTimestamps = this.amplitudeRateTimestamps.slice(-this.maxPoints);
        this.periodData = this.periodData.slice(-this.maxPoints);
        this.periodTimestamps = this.periodTimestamps.slice(-this.maxPoints);
        
        // Trim environmental sensor arrays
        this.bmp180Temperatures = this.bmp180Temperatures.slice(-this.maxPoints);
        this.bmp180Pressures = this.bmp180Pressures.slice(-this.maxPoints);
        this.bmp180Timestamps = this.bmp180Timestamps.slice(-this.maxPoints);
        this.sht85Temperatures = this.sht85Temperatures.slice(-this.maxPoints);
        this.sht85Humidities = this.sht85Humidities.slice(-this.maxPoints);
        this.sht85Timestamps = this.sht85Timestamps.slice(-this.maxPoints);
        this.sampledBMP390Temperatures = this.sampledBMP390Temperatures.slice(-this.maxPoints);
    }

    setMode(mode) {
        this.mode = mode;
        if (mode === 'live') {
            this.reset();
        }
    }

    async loadHistoricalData(startTime, endTime) {
        try {
            const response = await fetch(`/historical_data?start=${startTime}&end=${endTime}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            // Reset arrays before loading historical data
            this.reset();

            if (data == null) {
                console.error('No data returned from server');
                return false;
            }
            
            // Process each data point
            data.forEach(point => {
                const timeSeconds = point.total_micros / 1000000;
                if (this.timeOffset === null) {
                    this.timeOffset = timeSeconds;
                }

                // Add timestamp data
                this.timestamps.push(timeSeconds - this.timeOffset);
                this.timestampDrifts.push(point.timestamp_drift);

                // Add amplitude and period data
                if (point.amplitude !== null) {
                    this.amplitudeData.push(point.amplitude);
                    this.amplitudeTimestamps.push(timeSeconds - this.timeOffset);
                }
                if (point.period !== null) {
                    this.periodData.push(point.period);
                    this.periodTimestamps.push(timeSeconds - this.timeOffset);
                }

                // Add environmental data
                if (point.bmp180_temperature !== null) {
                    this.bmp180Temperatures.push(point.bmp180_temperature);
                    this.bmp180Pressures.push(point.bmp180_pressure);
                    this.bmp180Timestamps.push(timeSeconds - this.timeOffset);
                }
                if (point.bmp390_temperature !== null) {
                    this.bmp390Temperatures.push(point.bmp390_temperature);
                    this.bmp390Pressures.push(point.bmp390_pressure);
                    this.bmp390Timestamps.push(timeSeconds - this.timeOffset);
                }
                if (point.sht85_temperature !== null) {
                    this.sht85Temperatures.push(point.sht85_temperature);
                    this.sht85Humidities.push(point.sht85_humidity);
                    this.sht85Timestamps.push(timeSeconds - this.timeOffset);
                }

                // Add sampled temperature for correlation plots when we have a new period or amplitude measurement
                if (point.period !== null || point.amplitude !== null) {
                    this.sampledBMP390Temperatures.push(point.bmp390_temperature);
                }
            });

            return true;
        } catch (error) {
            console.error('Error loading historical data:', error);
            return false;
        }
    }
}
