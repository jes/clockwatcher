class ClockWatcher {
    constructor() {
        this.maxPoints = 2000;
        this.timestamps = [];
        this.counts = [];
        this.velocities = [];
        this.accelerations = [];
        this.ws = null;
        this.tareOffset = 0;
        this.timeOffset = 0;
        this.wsConnectionTimeout = 5000; // 5 second timeout
        this.wsReconnectDelay = 1000;   // 1 second delay between reconnection attempts
        this.wsConnectionAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.smoothingWindow = 20; // Number of points to use for moving average
        this.lastPositivePeak = null;
        this.lastNegativePeak = null;
        this.lastZeroCrossing = null;
        this.previousCount = null;
        
        // DOM elements
        this.serialStatus = document.getElementById('serial-status');
        this.wsStatus = document.getElementById('ws-status');
        this.serialPortsSelect = document.getElementById('serial-ports');
        this.connectBtn = document.getElementById('connect-btn');
        this.scanBtn = document.getElementById('scan-btn');
        this.tareBtn = document.getElementById('tare-btn');
        this.resetBtn = document.getElementById('reset-btn');
        
        // Initialize position display
        document.getElementById('current-position').textContent = '0°';
        
        // Initialize amplitude display
        document.getElementById('current-amplitude').textContent = '0°';
        
        // Initialize period displays
        document.getElementById('current-period').textContent = '0.0s';
        document.getElementById('positive-period').textContent = '0.0s';
        document.getElementById('negative-period').textContent = '0.0s';
        
        // Add new arrays for period and amplitude data
        this.periodData = [];
        this.amplitudeData = [];
        this.periodTimestamps = [];
        this.amplitudeTimestamps = [];
        
        // Add new arrays for amplitude rate data
        this.amplitudeRateData = [];
        this.amplitudeRateTimestamps = [];
        
        this.initializePlots();
        this.setupEventListeners();
        this.connectWebSocket();
        
        // Add plot update interval
        setInterval(() => this.updatePlots(), 100);
        
        // Add status tracking
        this.serialConnected = false;
        this.serialError = null;
    }

    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        this.scanBtn.addEventListener('click', () => this.fetchSerialPorts());
        this.tareBtn.addEventListener('click', () => this.handleTare());
        this.resetBtn.addEventListener('click', () => this.handleReset());
        
        // Add listener for averaging window changes
        document.getElementById('avg-window').addEventListener('change', () => this.updatePlots());
    }

    initializePlots() {
        const createLayout = (title, xAxisTitle, yAxisTitle) => ({
            autosize: true,
            responsive: true,
            margin: { l: 50, r: 50, t: 40, b: 40 },
            width: null,
            height: 400,
            title,
            xaxis: { title: xAxisTitle },
            yaxis: { title: yAxisTitle }
        });

        const layouts = {
            position: createLayout('Balance wheel position', 'Time (s)', 'Position (degrees)'),
            velocity: createLayout('Balance wheel velocity', 'Time (s)', 'Velocity (degrees/s)'),
            acceleration: createLayout('Balance wheel acceleration', 'Time (s)', 'Acceleration (degrees/s²)'),

            period: createLayout('Period', 'Time (s)', 'Period (s)'),
            amplitude: createLayout('Amplitude', 'Time (s)', 'Amplitude (degrees)'),
            amplitudeRate: createLayout('Rate of Change of Amplitude', 'Time (s)', 'Amplitude Rate (degrees/s)'),
            amplitudePeriod: createLayout('Amplitude vs Period', 'Amplitude (degrees)', 'Period (s)'),

            periodAvg: createLayout('Period (Averaged)', 'Time (s)', 'Period (s)'),
            amplitudeAvg: createLayout('Amplitude (Averaged)', 'Time (s)', 'Amplitude (degrees)'),
            amplitudeRateAvg: createLayout('Rate of Change of Amplitude (Averaged)', 'Time (s)', 'Amplitude Rate (degrees/s)'),
            amplitudePeriodAvg: createLayout('Amplitude vs Period (Averaged)', 'Amplitude (degrees)', 'Period (s)')
        };

        const createPlot = (elementId, x, y, layout, mode = 'lines') => {
            Plotly.newPlot(elementId, [{
                x, y, mode, 
                name: layout.title
            }], layout, { responsive: true, displayModeBar: false });
        };

        createPlot('position-chart', this.timestamps, this.counts, layouts.position);
        createPlot('velocity-chart', this.timestamps, this.velocities, layouts.velocity);
        createPlot('acceleration-chart', this.timestamps, this.accelerations, layouts.acceleration);

        createPlot('period-chart', this.periodTimestamps, this.periodData, layouts.period);
        createPlot('amplitude-chart', this.amplitudeTimestamps, this.amplitudeData, layouts.amplitude);
        createPlot('amplitude-rate-chart', this.amplitudeRateTimestamps, this.amplitudeRateData, layouts.amplitudeRate);
        createPlot('amplitude-period-chart', this.amplitudeData, this.periodData, layouts.amplitudePeriod);

        createPlot('period-chart-avg', this.periodTimestamps, this.periodData, layouts.periodAvg);
        createPlot('amplitude-chart-avg', this.amplitudeTimestamps, this.amplitudeData, layouts.amplitudeAvg);
        createPlot('amplitude-rate-chart-avg', this.amplitudeRateTimestamps, this.amplitudeRateData, layouts.amplitudeRateAvg);
        createPlot('amplitude-period-chart-avg', this.amplitudeData, this.periodData, layouts.amplitudePeriodAvg);
    }

    addReading(message) {
        // Set initial time offset on first reading
        if (this.timestamps.length === 0 && message.TotalMicros !== undefined) {
            this.timeOffset = message.TotalMicros / 1000000;
        }

        const timeSeconds = (message.TotalMicros / 1000000) - this.timeOffset;
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

    trimArray(array) {
        return array.length > this.maxPoints ? array.slice(-this.maxPoints) : array;
    }

    trimArrays() {
        this.timestamps = this.trimArray(this.timestamps);
        this.counts = this.trimArray(this.counts);
        this.velocities = this.trimArray(this.velocities);
        this.accelerations = this.trimArray(this.accelerations);
    }

    updatePlots() {
        const smoothedVelocities = this.movingAverage(this.velocities, this.smoothingWindow);
        const smoothedAccelerations = this.movingAverage(this.accelerations, this.smoothingWindow);

        // Get averaging window size from input
        const avgWindow = getAveragingWindow();

        // Calculate averaged data
        const avgAmplitude = this.movingAverage(this.amplitudeData, avgWindow);
        const avgPeriod = this.movingAverage(this.periodData, avgWindow);
        const avgAmplitudeRate = this.movingAverage(this.amplitudeRateData, avgWindow);

        const updates = [
            { id: 'position-chart', data: this.counts },
            { id: 'velocity-chart', data: smoothedVelocities },
            { id: 'acceleration-chart', data: smoothedAccelerations },

            { id: 'period-chart', x: this.periodTimestamps, y: this.periodData },
            { id: 'amplitude-chart', x: this.amplitudeTimestamps, y: this.amplitudeData },
            { id: 'amplitude-period-chart', x: this.amplitudeData, y: this.periodData },
            { id: 'amplitude-rate-chart', x: this.amplitudeRateTimestamps, y: this.amplitudeRateData },

            { id: 'period-chart-avg', x: this.periodTimestamps, y: avgPeriod },
            { id: 'amplitude-chart-avg', x: this.amplitudeTimestamps, y: avgAmplitude },
            { id: 'amplitude-rate-chart-avg', x: this.amplitudeRateTimestamps, y: avgAmplitudeRate },
            { id: 'amplitude-period-chart-avg', x: avgAmplitude, y: avgPeriod }
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
            let start = Math.max(0, i - window + 1);
            let sum = 0;
            for (let j = start; j <= i; j++) {
                sum += array[j];
            }
            result.push(sum / (i - start + 1));
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
            this.handleWebSocketMessage(event);
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
        
        // Update tare offset
        this.tareOffset += currentPosition;
        
        // Update existing data points
        this.counts = this.counts.map(count => count - currentPosition);
        
        // Update the display
        document.getElementById('current-position').textContent = 
            `${(this.counts[this.counts.length - 1] || 0).toFixed(0)}°`;
            
        // Reset period measurements when taring
        this.lastZeroCrossing = null;
        document.getElementById('current-period').textContent = '0.0s';
        document.getElementById('positive-period').textContent = '0.0s';
        document.getElementById('negative-period').textContent = '0.0s';
        
        // Reset peak detection when taring
        this.lastPositivePeak = null;
        this.lastNegativePeak = null;
        document.getElementById('current-amplitude').textContent = '0°';
        document.getElementById('positive-peak').textContent = '+0°';
        document.getElementById('negative-peak').textContent = '-0°';
        
        // Force plot update
        this.updatePlots();
    }

    handleReset() {
        // Clear all data arrays
        this.timestamps = [];
        this.counts = [];
        this.velocities = [];
        this.accelerations = [];
        this.periodData = [];
        this.amplitudeData = [];
        this.periodTimestamps = [];
        this.amplitudeTimestamps = [];
        this.amplitudeRateData = [];
        this.amplitudeRateTimestamps = [];
        
        // Reset peak and crossing detection
        this.lastPositivePeak = null;
        this.lastNegativePeak = null;
        this.lastZeroCrossing = null;
        
        // Reset displays
        document.getElementById('current-position').textContent = '0°';
        document.getElementById('current-amplitude').textContent = '0°';
        document.getElementById('current-period').textContent = '0.0s';
        document.getElementById('positive-period').textContent = '0.0s';
        document.getElementById('negative-period').textContent = '0.0s';
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
        const timeSinceLastZeroCrossing = currentTime - this.lastZeroCrossing;
        if (prev !== null && current !== null && timeSinceLastZeroCrossing > 0.1) {
            // Positive-going zero crossing
            if (prev <= 0 && current > 0) {
                if (this.lastZeroCrossing !== null) {
                    const positivePeriod = currentTime - this.lastZeroCrossing;
                    document.getElementById('positive-period').textContent = 
                        `${positivePeriod.toFixed(6)}s`;
                }
                this.lastZeroCrossing = currentTime;
                this.updateTotalPeriod();
            }
            // Negative-going zero crossing
            else if (prev >= 0 && current < 0) {
                if (this.lastZeroCrossing !== null) {
                    const negativePeriod = currentTime - this.lastZeroCrossing;
                    document.getElementById('negative-period').textContent = 
                        `${negativePeriod.toFixed(6)}s`;
                }
                this.lastZeroCrossing = currentTime;
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
            
            if (Math.abs(amplitude) > 10) {
                const currentTime = this.timestamps[this.timestamps.length - 1];
                
                // Calculate rate of change of amplitude
                if (this.amplitudeData.length > 1) {
                    const deltaAmplitude = amplitude - this.amplitudeData[this.amplitudeData.length - 1];
                    const deltaTime = currentTime - this.amplitudeTimestamps[this.amplitudeTimestamps.length - 1];
                    const amplitudeRate = deltaAmplitude / deltaTime;
                    
                    this.amplitudeRateData.push(amplitudeRate);
                    this.amplitudeRateTimestamps.push(currentTime);
                    
                    // Trim amplitude rate data if too long
                    if (this.amplitudeRateData.length > this.maxPoints) {
                        this.amplitudeRateData = this.amplitudeRateData.slice(-this.maxPoints);
                        this.amplitudeRateTimestamps = this.amplitudeRateTimestamps.slice(-this.maxPoints);
                    }
                }

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
    }

    updateTotalPeriod() {
        if (this.lastZeroCrossing) {
            const positivePeriod = parseFloat(document.getElementById('positive-period').textContent) || 0;
            const negativePeriod = parseFloat(document.getElementById('negative-period').textContent) || 0;
            const totalPeriod = positivePeriod + negativePeriod;

            // Only add period data if both halves are nonzero
            if (negativePeriod > 0 && positivePeriod > 0) {
                document.getElementById('current-period').textContent = 
                    `${totalPeriod.toFixed(6)}s`;
            
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

    handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            // Check if it's a status message by looking for Device property
            if (message.Device) {
                this.handleStatusMessage(message);
            } 
            // Otherwise treat it as a reading message
            else if (message.TotalMicros !== undefined) {
                this.addReading(message);
            } else {
                console.warn('Unknown message format:', message);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }

    handleStatusMessage(message) {
        const STATUS_HANDLERS = {
            CONNECTED: (status) => ({
                text: 'Serial: Connected',
                class: 'status-success',
                connected: true,
                error: null
            }),
            DISCONNECTED: () => ({
                text: 'Serial: Disconnected',
                class: 'status-error',
                connected: false
            }),
            OVERFLOW: (status) => ({
                text: 'Serial: Buffer Overflow',
                class: 'status-info',
                error: null
            }),
            ERROR: (status) => ({
                text: `Serial: Error - ${status.Error}`,
                class: 'status-error',
                error: status.Error
            })
        };

        if (message.Device === 'SERIAL') {
            const handler = STATUS_HANDLERS[message.Status];
            if (handler) {
                const status = handler(message);
                this.serialStatus.textContent = status.text;
                this.serialStatus.className = status.class;
                if (status.connected !== undefined) this.serialConnected = status.connected;
                if (status.error !== undefined) this.serialError = status.error;
            } else {
                console.warn('Unknown serial status:', message.Status);
            }
        }
    }
}

// Add this function to get the averaging window size
function getAveragingWindow() {
    const windowInput = document.getElementById('avg-window');
    const value = parseInt(windowInput.value);
    return isNaN(value) || value < 1 ? 1 : value;
}

// Initialize the application
const app = new ClockWatcher();