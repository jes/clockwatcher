class ClockWatcher {
    constructor() {
        this.maxPoints = 500;
        this.timestamps = [];
        this.counts = [];
        this.velocities = [];
        this.accelerations = [];
        this.ws = null;
        
        // DOM elements
        this.serialStatus = document.getElementById('serial-status');
        this.wsStatus = document.getElementById('ws-status');
        this.serialPortsSelect = document.getElementById('serial-ports');
        this.connectBtn = document.getElementById('connect-btn');
        this.scanBtn = document.getElementById('scan-btn');
        
        // Initialize position display
        document.getElementById('current-position').textContent = '0°';
        
        this.initializePlots();
        this.setupEventListeners();
        this.connectWebSocket();
        
        // Add plot update interval
        setInterval(() => this.updatePlots(), 100);
    }

    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        this.scanBtn.addEventListener('click', () => this.fetchSerialPorts());
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
        const degrees = message.Count * 4;
        
        // Update instantaneous value display
        document.getElementById('current-position').textContent = 
            `${(degrees || 0).toFixed(0)}°`;

        this.timestamps.push(timeSeconds);
        this.counts.push(degrees || 0);

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
        const numPoints = 5; // Number of points to average over
        if (this.timestamps.length < numPoints) return 0;
        
        // Get the last n points
        const recentTimes = this.timestamps.slice(-numPoints);
        const recentPositions = this.counts.slice(-numPoints);
        
        // Calculate velocity using linear regression
        let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0;
        const n = recentTimes.length;
        
        for (let i = 0; i < n; i++) {
            sumXY += recentTimes[i] * recentPositions[i];
            sumX += recentTimes[i];
            sumY += recentPositions[i];
            sumX2 += recentTimes[i] * recentTimes[i];
        }
        
        // Slope of the regression line = velocity
        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    }

    calculateAcceleration() {
        const numPoints = 5; // Number of points to average over
        if (this.velocities.length < numPoints) return 0;
        
        // Get the last n points
        const recentTimes = this.timestamps.slice(-numPoints);
        const recentVelocities = this.velocities.slice(-numPoints);
        
        // Calculate acceleration using linear regression
        let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0;
        const n = recentTimes.length;
        
        for (let i = 0; i < n; i++) {
            sumXY += recentTimes[i] * recentVelocities[i];
            sumX += recentTimes[i];
            sumY += recentVelocities[i];
            sumX2 += recentTimes[i] * recentTimes[i];
        }
        
        // Slope of the regression line = acceleration
        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
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
        const updates = [
            { id: 'chart', data: this.counts },
            { id: 'velocity-chart', data: this.velocities },
            { id: 'acceleration-chart', data: this.accelerations }
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

        this.ws.onopen = () => {
            console.log('WebSocket connected successfully');
            this.wsStatus.textContent = 'WebSocket: Connected';
            this.wsStatus.className = 'status-success';
            // Fetch serial ports when WebSocket connects
            this.fetchSerialPorts();
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket closed:', event);
            this.wsStatus.textContent = 'WebSocket: Disconnected';
            this.wsStatus.className = 'status-error';
            // Attempt to reconnect after a delay
            setTimeout(() => this.connectWebSocket(), 1000);
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
}

// Initialize the application
const app = new ClockWatcher();