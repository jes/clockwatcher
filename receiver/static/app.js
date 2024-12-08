class ClockWatcher {
    constructor() {
        this.ui = new UI();
        this.data = new DataRecorder();
        this.plots = new Plots();
        this.serial = new SerialManager(this.ui);
        this.ws = new WebSocketManager();
        
        this.initializeApp();
    }

    async initializeApp() {
        // Load initial tare value
        const initialTare = await this.serial.getTare();
        this.data.tareOffset = initialTare;

        // Setup WebSocket status handling
        this.ws.onStatus((status, ...args) => {
            switch (status) {
                case 'connected':
                    this.ui.updateWebSocketStatus('WebSocket: Connected');
                    break;
                case 'disconnected':
                    this.ui.updateWebSocketStatus('WebSocket: Disconnected', true);
                    break;
                case 'error':
                    this.ui.updateWebSocketStatus('WebSocket: Error', true);
                    break;
                case 'reconnecting':
                    const [attempt, maxAttempts] = args;
                    this.ui.updateWebSocketStatus(
                        `WebSocket: Reconnecting (Attempt ${attempt}/${maxAttempts})`,
                        true
                    );
                    break;
                case 'failed':
                    this.ui.updateWebSocketStatus(
                        'WebSocket: Connection failed. Please refresh the page.',
                        true
                    );
                    break;
            }
        });

        // Connect WebSocket
        this.ws.connect();
        
        // Setup message handling
        this.ws.onMessage((message) => {
            if (message.Device) {
                this.serial.handleStatus(message);
            } else if (message.TotalMicros !== undefined) {
                this.data.addReading(message);
            } else if (message.type === 'BMP180') {
                this.data.addBMP180Reading(message);
            } else if (message.type === 'SHT85') {
                this.data.addSHT85Reading(message);
            }
        });
        
        // Setup UI event handlers
        this.ui.onConnect(() => this.serial.connect(this.ui.getPortSelection()));
        this.ui.onScan(() => this.serial.fetchSerialPorts());
        this.ui.onTare(async () => {
            const currentValue = this.data.getCurrentPosition();
            this.data.tare();
            await this.serial.setTare(this.data.tareOffset);
            this.redraw();
        });
        this.ui.onReset(() => {
            this.data.reset();
            this.plots.reset();
            this.redraw();
        });

        // Add mode switching handler
        this.ui.onModeChange((mode) => {
            this.data.setMode(mode);
            
            // Handle WebSocket connection based on mode
            if (mode === 'live') {
                this.ws.connect();
                this.scheduleRedraw();
            } else {
                this.ws.disconnect();
                this.ui.updateWebSocketStatus('WebSocket: Disconnected (Historical Mode)');
            }
        });

        // Add historical data loading handler
        this.ui.onLoadHistoricalData(async (startTime, endTime) => {
            const success = await this.data.loadHistoricalData(startTime, endTime);
            if (success) {
                this.redraw();
            } else {
                // TODO: Show error message to user
                console.error('Failed to load historical data');
            }
        });

        this.serial.fetchSerialPorts();
        
        // Start periodic plot updates for live mode
        this.scheduleRedraw();
    }

    scheduleRedraw() {
        if (!this.redrawInProgress && this.data.mode === 'live') {
            this.redrawInProgress = true;
            this.redraw();
            setTimeout(() => {
                this.redrawInProgress = false;
                this.scheduleRedraw();
            }, 100);
        }
    }

    redraw() {
        this.plots.updateAll(this.data);
        this.ui.updateDisplays(this.data);
    }
}

// Initialize app
const app = new ClockWatcher();