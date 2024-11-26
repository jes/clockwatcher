class SerialManager {
    constructor(ui) {
        this.ui = ui;
        this.connected = false;
        this.error = null;
    }
    
    async fetchSerialPorts() {
        try {
            const response = await fetch('/serial_ports');
            if (!response.ok) {
                throw new Error('Failed to fetch serial ports');
            }
            const ports = await response.json();
            this.ui.updateSerialPorts(ports);
        } catch (error) {
            console.error('Error fetching serial ports:', error);
            this.handleError('Failed to fetch ports');
        }
    }
    
    async connect(portName) {
        if (!portName) return;

        try {
            const response = await fetch('/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    port_name: portName,
                    baud_rate: 115200
                })
            });

            if (!response.ok) {
                throw new Error('Connection failed');
            }
            
            this.connected = true;
            this.error = null;
            this.ui.updateSerialStatus('Serial: Connected');
        } catch (error) {
            console.error('Error connecting to serial port:', error);
            this.handleError('Connection failed');
        }
    }
    
    handleStatus(message) {
        const STATUS_HANDLERS = {
            CONNECTED: () => {
                this.connected = true;
                this.error = null;
                this.ui.updateSerialStatus('Serial: Connected');
            },
            DISCONNECTED: () => {
                this.connected = false;
                this.ui.updateSerialStatus('Serial: Disconnected', true);
            },
            OVERFLOW: () => {
                this.ui.updateSerialStatus('Serial: Buffer Overflow', true);
            },
            ERROR: (status) => {
                this.handleError(status.Error);
            }
        };

        if (message.Device === 'SERIAL' && STATUS_HANDLERS[message.Status]) {
            STATUS_HANDLERS[message.Status](message);
        } else {
            console.warn('Unknown serial status:', message.Status);
        }
    }
    
    handleError(error) {
        this.connected = false;
        this.error = error;
        this.ui.updateSerialStatus(`Serial: Error - ${error}`, true);
    }
    
    isConnected() {
        return this.connected;
    }
    
    getError() {
        return this.error;
    }
} 