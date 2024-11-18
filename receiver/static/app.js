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
    }

    addReading(message) {
        const timeSeconds = message.TotalMicros / 1000000;
        const degrees = (message.Count * 2) - this.tareOffset;
        
        // Update instantaneous value display
        document.getElementById('current-position').textContent = 
            `${(degrees || 0).toFixed(0)}°`;

        this.timestamps.push(timeSeconds);
        this.counts.push(degrees || 0);
        
        // Add peak detection after adding new reading
        this.detectPeaks();

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
        // Apply smoothing to velocity and acceleration data
        const smoothedVelocities = this.movingAverage(this.velocities, this.smoothingWindow);
        const smoothedAccelerations = this.movingAverage(this.accelerations, this.smoothingWindow);

        const updates = [
            { id: 'chart', data: this.counts },
            { id: 'velocity-chart', data: smoothedVelocities },
            { id: 'acceleration-chart', data: smoothedAccelerations }
        ];

        updates.forEach(({ id, data }) => {
            Plotly.update(id, {
                x: [this.timestamps],
                y: [data]
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
            
        // Reset peak detection when taring
        this.lastPositivePeak = null;
        this.lastNegativePeak = null;
        document.getElementById('current-amplitude').textContent = '0°';
        
        // Force plot update
        this.updatePlots();
    }

    detectPeaks() {
        const n = this.counts.length;
        if (n < 3) return;  // Need at least 3 points to detect a peak

        const current = this.counts[n - 2];  // Look at second-to-last point
        const prev = this.counts[n - 3];
        const next = this.counts[n - 1];

        // Detect positive peak
        if (current > prev && current > next) {
            this.lastPositivePeak = current;
        }
        // Detect negative peak
        else if (current < prev && current < next) {
            this.lastNegativePeak = current;
        }

        // Calculate and display amplitude if we have both peaks
        if (this.lastPositivePeak !== null && this.lastNegativePeak !== null) {
            const amplitude = this.lastPositivePeak - this.lastNegativePeak;
            document.getElementById('current-amplitude').textContent = 
                `${Math.abs(amplitude).toFixed(0)}°`;
        }
    }
}

// Initialize the application
const app = new ClockWatcher();