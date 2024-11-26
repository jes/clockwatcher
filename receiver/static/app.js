class ClockWatcher {
    constructor() {
        this.ui = new UI();
        this.data = new DataRecorder();
        this.plots = new Plots();
        this.serial = new SerialManager(this.ui);
        this.ws = new WebSocketManager();
        
        this.initializeApp();
    }

    initializeApp() {
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
            }
        });
        
        // Setup UI event handlers
        this.ui.onConnect(() => this.serial.connect(this.ui.getPortSelection()));
        this.ui.onScan(() => this.serial.fetchSerialPorts());
        this.ui.onTare(() => {
            this.data.tare();
            this.ui.updateDisplays(this.data);
            this.plots.updateAll(this.data);
        });
        this.ui.onReset(() => {
            this.data.reset();
            this.ui.updateDisplays(this.data);
            this.plots.updateAll(this.data);
        });

        this.serial.fetchSerialPorts();
        
        // Start periodic plot updates
        setInterval(() => {
            this.plots.updateAll(this.data);
            this.ui.updateDisplays(this.data);
        }, 100);
    }
}

// Initialize app
const app = new ClockWatcher();