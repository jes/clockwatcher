class DataRecorder {
    constructor() {
        this.reset();
    }

    reset() {
        this.maxPoints = 2000;
        this.timestamps = [];
        this.counts = [];
        this.velocities = [];
        this.accelerations = [];
        this.tareOffset = 0;
        this.timeOffset = 0;
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
        this.tareOffset = this.counts[this.counts.length - 1];
        this.counts = this.counts.map(count => count - this.tareOffset);
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
        
        let amplitudeUpdated = false;

        // Detect positive peak
        if (middlePoint > prevPoint && middlePoint > currentPoint) {
            this.lastPositivePeak = middlePoint;
            amplitudeUpdated = true;
        }
        // Detect negative peak
        else if (middlePoint < prevPoint && middlePoint < currentPoint) {
            this.lastNegativePeak = middlePoint;
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