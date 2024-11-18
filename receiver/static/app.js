class ClockWatcher {
    constructor() {
        this.maxPoints = 500;
        this.timestamps = [];
        this.counts = [];
        this.velocities = [];
        this.accelerations = [];
        this.ws = null;
        this.tareOffset = 0;
        this.wsConnectionTimeout = 5000; // 5 second timeout
        this.wsReconnectDelay = 1000;   // 1 second delay between reconnection attempts
        this.wsConnectionAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.smoothingWindow = 20; // Number of points to use for moving average
        this.lastPositivePeak = null;
        this.lastNegativePeak = null;
        this.lastZeroCrossing = null;
        this.lastPositiveZeroCrossing = null;
        this.lastNegativeZeroCrossing = null;
        this.previousCount = null;
        
        // DOM elements
        this.serialStatus = document.getElementById('serial-status');
        this.wsStatus = document.getElementById('ws-status');
        this.serialPortsSelect = document.getElementById('serial-ports');
        this.connectBtn = document.getElementById('connect-btn');
        this.scanBtn = document.getElementById('scan-btn');
        this.tareBtn = document.getElementById('tare-btn');
        
        // Initialize position display
        document.getElementById('current-position').textContent = '0°';
        
        // Initialize amplitude display
        document.getElementById('current-amplitude').textContent = '0°';
        
        // Initialize period displays
        document.getElementById('current-period').textContent = '0.0s';
        document.getElementById('positive-period').textContent = '+0.0s';
        document.getElementById('negative-period').textContent = '-0.0s';
        
        // Add new arrays for period and amplitude data
        this.periodData = [];
        this.amplitudeData = [];
        this.periodTimestamps = [];
        this.amplitudeTimestamps = [];
        
        this.initializePlots();
        this.setupEventListeners();
        this.connectWebSocket();
        
        // Add plot update interval
        setInterval(() => this.updatePlots(), 100);
    }

    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        this.scanBtn.addEventListener('click', () => this.fetchSerialPorts());
        this.tareBtn.addEventListener('click', () => this.handleTare());
    }

    initializePlots() {
        // Update CSS for charts
        ['chart', 'velocity-chart', 'acceleration-chart'].forEach(id => {
            document.getElementById(id).style.height = '400px';
        });

        const layouts = {
            position: {
                title: 'Balance wheel position',
                xaxis: { title: 'Time (s)' },
                yaxis: { title: 'Position (degrees)' }
            },
            velocity: {
                title: 'Balance wheel velocity',
                xaxis: { title: 'Time (s)' },
                yaxis: { title: 'Velocity (degrees/s)' }
            },
            acceleration: {
                title: 'Balance wheel acceleration',
                xaxis: { title: 'Time (s)' },
                yaxis: { title: 'Acceleration (degrees/s²)' }
            },
            period: {
                title: 'Period',
                xaxis: { title: 'Time (s)' },
                yaxis: { title: 'Period (s)' }
            },
            amplitude: {
                title: 'Amplitude',
                xaxis: { title: 'Time (s)' },
                yaxis: { title: 'Amplitude (degrees)' }
            }
        };

        // Initialize all plots
        Plotly.newPlot('chart', [{
            x: this.timestamps,
            y: this.counts,
            mode: 'lines',
            name: 'Position'
        }], layouts.position);

        Plotly.newPlot('velocity-chart', [{
            x: this.timestamps,
            y: this.velocities,
            mode: 'lines',
            name: 'Velocity'
        }], layouts.velocity);

        Plotly.newPlot('acceleration-chart', [{
            x: this.timestamps,
            y: this.accelerations,
            mode: 'lines',
            name: 'Acceleration'
        }], layouts.acceleration);

        // Initialize period and amplitude plots
        Plotly.newPlot('period-chart', [{
            x: this.periodTimestamps,
            y: this.periodData,
            mode: 'lines',
            name: 'Period'
        }], layouts.period);

        Plotly.newPlot('amplitude-chart', [{
            x: this.amplitudeTimestamps,
            y: this.amplitudeData,
            mode: 'lines',
            name: 'Amplitude'
        }], layouts.amplitude);
    }

    addReading(message) {
        const timeSeconds = message.TotalMicros / 1000000;
        const degrees = (message.Count * 2) - this.tareOffset;
        
        // Update instantaneous value display
        document.getElementById('current-position').textContent = 
            `${(degrees || 0).toFixed(0)}°`;

        this.timestamps.push(timeSeconds);
        this.counts.push(degrees || 0);
        
        // Replace detectPeaks with detectCrossingsAndPeaks
        this.detectCrossingsAndPeaks();

        // Calculate velocity
        const currentVelocity = this.calculateVelocity();
        this.velocities.push(currentVelocity);

        // Calculate acceleration
        const acceleration = this.calculateAcceleration();
        this.accelerations.push(acceleration);

        // Trim arrays to maxPoints
        this.trimArrays();
    }

    calculateVelocity() {
        const step = 10;  // Use 10 points of separation for finite difference
        if (this.timestamps.length < step) return 0;
        
        // Get points separated by 'step' positions
        const dt = this.timestamps[this.timestamps.length - 1] - this.timestamps[this.timestamps.length - step];
        const dp = this.counts[this.counts.length - 1] - this.counts[this.counts.length - step];
        
        return dp / dt; // degrees per second
    }

    calculateAcceleration() {
        const step = 10;  // Use 10 points of separation for finite difference
        if (this.velocities.length < step) return 0;
        
        // Get velocity points separated by 'step' positions
        const dt = this.timestamps[this.timestamps.length - 1] - this.timestamps[this.timestamps.length - step];
        const dv = this.velocities[this.velocities.length - 1] - this.velocities[this.velocities.length - step];
        
        return dv / dt; // degrees per second²
    }

    trimArrays() {
        if (this.timestamps.length > this.maxPoints) {
            this.timestamps = this.timestamps.slice(-this.maxPoints);
            this.counts = this.counts.slice(-this.maxPoints);
            this.velocities = this.velocities.slice(-this.maxPoints);
            this.accelerations = this.accelerations.slice(-this.maxPoints);
        }
    }

    updatePlots() {
        const smoothedVelocities = this.movingAverage(this.velocities, this.smoothingWindow);
        const smoothedAccelerations = this.movingAverage(this.accelerations, this.smoothingWindow);

        const updates = [
            { id: 'chart', data: this.counts },
            { id: 'velocity-chart', data: smoothedVelocities },
            { id: 'acceleration-chart', data: smoothedAccelerations },
            { id: 'period-chart', x: this.periodTimestamps, y: this.periodData },
            { id: 'amplitude-chart', x: this.amplitudeTimestamps, y: this.amplitudeData }
        ];

        updates.forEach(({ id, data, x, y }) => {
            Plotly.update(id, {
                x: [x || this.timestamps],
                y: [y || data]
            }).catch(error => {
                console.error(`Error updating ${id}:`, error);
            });
        });
    }

    movingAverage(array, window) {
        if (window <= 1) return array;
        
        const result = [];
        for (let i = 0; i < array.length; i++) {
            let start = Math.max(0, i - Math.floor(window / 2));
            let end = Math.min(array.length, i + Math.floor(window / 2) + 1);
            let sum = 0;
            for (let j = start; j < end; j++) {
                sum += array[j];
            }
            result.push(sum / (end - start));
        }
        return result;
    }

    async fetchSerialPorts() {
        try {
            const response = await fetch('/serial_ports');
            const ports = await response.json();
            
            // Clear existing options
            this.serialPortsSelect.innerHTML = '';
            
            // Add new options
            ports.forEach(port => {
                const option = document.createElement('option');
                option.value = port;
                option.textContent = port;
                this.serialPortsSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error fetching serial ports:', error);
        }
    }

    async handleConnect() {
        const port = this.serialPortsSelect.value;
        if (!port) return;

        try {
            const response = await fetch('/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    port_name: port,
                    baud_rate: 115200
                })
            });

            if (response.ok) {  // Checks if status is 200-299
                this.serialStatus.textContent = 'Serial: Connected';
                this.serialStatus.className = 'status-success';
            } else {
                this.serialStatus.textContent = 'Serial: Connection Failed';
                this.serialStatus.className = 'status-error';
            }
        } catch (error) {
            console.error('Error connecting to serial port:', error);
            this.serialStatus.textContent = 'Serial: Connection Error';
            this.serialStatus.className = 'status-error';
        }
    }

    connectWebSocket() {
        const wsUrl = `ws://${window.location.host}/ws`;
        console.log('Attempting to connect to WebSocket at:', wsUrl);
        
        this.ws = new WebSocket(wsUrl);
        this.wsConnectionAttempts++;

        // Set connection timeout
        const connectionTimeout = setTimeout(() => {
            if (this.ws.readyState !== WebSocket.OPEN) {
                console.log('WebSocket connection timeout');
                this.ws.close();
                this.handleReconnect();
            }
        }, this.wsConnectionTimeout);

        this.ws.onopen = () => {
            console.log('WebSocket connected successfully');
            clearTimeout(connectionTimeout);
            this.wsConnectionAttempts = 0;
            this.wsStatus.textContent = 'WebSocket: Connected';
            this.wsStatus.className = 'status-success';
            this.fetchSerialPorts();
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket closed:', event);
            clearTimeout(connectionTimeout);
            this.wsStatus.textContent = 'WebSocket: Disconnected';
            this.wsStatus.className = 'status-error';
            this.handleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.wsStatus.textContent = 'WebSocket: Error';
            this.wsStatus.className = 'status-error';
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.addReading(message);
            } catch (error) {
                console.error('Error processing message:', error);
            }
        };
    }

    handleReconnect() {
        if (this.wsConnectionAttempts < this.maxReconnectAttempts) {
            this.wsStatus.textContent = `WebSocket: Reconnecting (Attempt ${this.wsConnectionAttempts}/${this.maxReconnectAttempts})`;
            setTimeout(() => this.connectWebSocket(), this.wsReconnectDelay);
        } else {
            this.wsStatus.textContent = 'WebSocket: Connection failed. Please refresh the page.';
            console.error('Maximum WebSocket reconnection attempts reached');
        }
    }

    handleTare() {
        // Get the last position value
        const currentPosition = this.counts[this.counts.length - 1] || 0;
        this.tareOffset += currentPosition;
        
        // Update existing data points
        this.counts = this.counts.map(count => count - currentPosition);
        
        // Update the display
        document.getElementById('current-position').textContent = 
            `${(this.counts[this.counts.length - 1] || 0).toFixed(0)}°`;
            
        // Reset period measurements when taring
        this.lastZeroCrossing = null;
        this.lastPositiveZeroCrossing = null;
        this.lastNegativeZeroCrossing = null;
        document.getElementById('current-period').textContent = '0.0s';
        document.getElementById('positive-period').textContent = '+0.0s';
        document.getElementById('negative-period').textContent = '-0.0s';
        
        // Reset peak detection when taring
        this.lastPositivePeak = null;
        this.lastNegativePeak = null;
        document.getElementById('current-amplitude').textContent = '0°';
        document.getElementById('positive-peak').textContent = '+0°';
        document.getElementById('negative-peak').textContent = '-0°';
        
        // Force plot update
        this.updatePlots();
    }

    detectCrossingsAndPeaks() {
        const n = this.counts.length;
        if (n < 2) return;  // Need at least 2 points for zero crossing

        const current = this.counts[n - 1];
        const prev = this.counts[n - 2];
        const currentTime = this.timestamps[n - 1];

        // Zero crossing detection
        if (prev !== null && current !== null) {
            // Positive-going zero crossing
            if (prev <= 0 && current > 0) {
                if (this.lastPositiveZeroCrossing !== null) {
                    const positivePeriod = currentTime - this.lastPositiveZeroCrossing;
                    document.getElementById('positive-period').textContent = 
                        `+${positivePeriod.toFixed(3)}s`;
                }
                this.lastPositiveZeroCrossing = currentTime;
                this.updateTotalPeriod();
            }
            // Negative-going zero crossing
            else if (prev >= 0 && current < 0) {
                if (this.lastNegativeZeroCrossing !== null) {
                    const negativePeriod = currentTime - this.lastNegativeZeroCrossing;
                    document.getElementById('negative-period').textContent = 
                        `-${negativePeriod.toFixed(3)}s`;
                }
                this.lastNegativeZeroCrossing = currentTime;
                this.updateTotalPeriod();
            }
        }

        // Detect peaks and update amplitude
        if (n < 3) return;
        const middlePoint = this.counts[n - 2];
        const prevPoint = this.counts[n - 3];

        let amplitudeUpdated = false;  // Flag to track if amplitude was updated

        // Detect positive peak
        if (middlePoint > prevPoint && middlePoint > this.counts[n - 1]) {
            this.lastPositivePeak = middlePoint;
            amplitudeUpdated = true;
        }
        // Detect negative peak
        else if (middlePoint < prevPoint && middlePoint < this.counts[n - 1]) {
            this.lastNegativePeak = middlePoint;
            amplitudeUpdated = true;
        }

        // Update amplitude plot only when we have both peaks AND a new peak was detected
        if (this.lastPositivePeak !== null && this.lastNegativePeak !== null && amplitudeUpdated) {
            const amplitude = Math.abs(this.lastPositivePeak - this.lastNegativePeak);
            
            // Add amplitude data point
            this.amplitudeData.push(amplitude);
            this.amplitudeTimestamps.push(this.timestamps[this.timestamps.length - 1]);
            
            // Trim amplitude data if too long
            if (this.amplitudeData.length > this.maxPoints) {
                this.amplitudeData = this.amplitudeData.slice(-this.maxPoints);
                this.amplitudeTimestamps = this.amplitudeTimestamps.slice(-this.maxPoints);
            }
            
            // Update displays
            document.getElementById('current-amplitude').textContent = 
                `${amplitude.toFixed(0)}°`;
            document.getElementById('positive-peak').textContent = 
                `+${this.lastPositivePeak.toFixed(0)}°`;
            document.getElementById('negative-peak').textContent = 
                `${this.lastNegativePeak.toFixed(0)}°`;
        }
    }

    updateTotalPeriod() {
        if (this.lastPositiveZeroCrossing && this.lastNegativeZeroCrossing) {
            const positivePeriod = parseFloat(document.getElementById('positive-period').textContent) || 0;
            const negativePeriod = Math.abs(parseFloat(document.getElementById('negative-period').textContent)) || 0;
            const totalPeriod = positivePeriod + negativePeriod;
            
            document.getElementById('current-period').textContent = 
                `${totalPeriod.toFixed(3)}s`;
            
            // Add period data point
            this.periodData.push(totalPeriod);
            this.periodTimestamps.push(this.timestamps[this.timestamps.length - 1]);
            
            // Trim period data if too long
            if (this.periodData.length > this.maxPoints) {
                this.periodData = this.periodData.slice(-this.maxPoints);
                this.periodTimestamps = this.periodTimestamps.slice(-this.maxPoints);
            }
        }
    }
}

// Initialize the application
const app = new ClockWatcher();