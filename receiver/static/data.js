class DataRecorder {
    constructor() {
        this.tareOffset = 0;
        this.timeOffset = 0;
        this.reset();
    }

    reset() {
        this.maxPoints = 2000;
        this.timestamps = [];
        this.counts = [];
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

    addReading(message) {
        if (this.timestamps.length === 0 && message.TotalMicros !== undefined) {
            this.timeOffset = message.TotalMicros / 1000000;
        }

        const timeSeconds = (message.TotalMicros / 1000000) - this.timeOffset;
        const degrees = (message.Count * 2) - this.tareOffset;

        this.timestamps.push(timeSeconds);
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

    calculateFiniteDifference(array, step) {
        if (array.length < step) return 0;
        
        const dt = this.timestamps[this.timestamps.length - 1] - 
                  this.timestamps[this.timestamps.length - step];
        const dy = array[array.length - 1] - array[array.length - step];
        
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
        if (this.lastPositiveHalfperiod !== null && this.lastNegativeHalfperiod !== null) {
            this.periodData.push(this.lastPositiveHalfperiod + this.lastNegativeHalfperiod);
            this.periodTimestamps.push(this.timestamps[this.timestamps.length - 1]);
        }
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

        // Update amplitude data when we have both peaks and a new peak was detected
        if (this.lastPositivePeak !== null && this.lastNegativePeak !== null && amplitudeUpdated) {
            const amplitude = this.lastPositivePeak - this.lastNegativePeak;
            
            if (Math.abs(amplitude) > 10) {
                const currentTime = this.timestamps[n - 1];
                
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
            }
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
        this.velocities = this.velocities.slice(-this.maxPoints);
        this.accelerations = this.accelerations.slice(-this.maxPoints);
        this.amplitudeData = this.amplitudeData.slice(-this.maxPoints);
        this.amplitudeTimestamps = this.amplitudeTimestamps.slice(-this.maxPoints);
        this.amplitudeRateData = this.amplitudeRateData.slice(-this.maxPoints);
        this.amplitudeRateTimestamps = this.amplitudeRateTimestamps.slice(-this.maxPoints);
        this.periodData = this.periodData.slice(-this.maxPoints);
        this.periodTimestamps = this.periodTimestamps.slice(-this.maxPoints);
    }
}
