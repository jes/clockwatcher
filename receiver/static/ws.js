class WebSocketManager {
    constructor() {
        this.ws = null;
        this.config = {
            timeout: 5000,
            reconnectDelay: 1000,
            maxAttempts: 5
        };
        this.attempts = 0;
        this.messageHandler = null;
        this.statusHandler = null;
    }
    
    connect() {
        const wsUrl = `ws://${window.location.host}/ws`;
        console.log('Attempting to connect to WebSocket at:', wsUrl);
        
        this.ws = new WebSocket(wsUrl);
        this.attempts++;

        const connectionTimeout = setTimeout(() => {
            if (this.ws.readyState !== WebSocket.OPEN) {
                console.log('WebSocket connection timeout');
                this.ws.close();
                this.handleReconnect();
            }
        }, this.config.timeout);

        this.setupWebSocketHandlers(connectionTimeout);
    }
    
    setupWebSocketHandlers(connectionTimeout) {
        this.ws.onopen = () => {
            console.log('WebSocket connected successfully');
            clearTimeout(connectionTimeout);
            this.attempts = 0;
            this.notifyStatus('connected');
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket closed:', event);
            clearTimeout(connectionTimeout);
            this.notifyStatus('disconnected');
            this.handleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.notifyStatus('error');
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (this.messageHandler) {
                    this.messageHandler(message);
                }
            } catch (error) {
                console.error('Error processing message:', error);
            }
        };
    }
    
    handleReconnect() {
        if (this.attempts < this.config.maxAttempts) {
            this.notifyStatus('reconnecting', this.attempts, this.config.maxAttempts);
            setTimeout(() => this.connect(), this.config.reconnectDelay);
        } else {
            this.notifyStatus('failed');
            console.error('Maximum WebSocket reconnection attempts reached');
        }
    }
    
    onMessage(callback) {
        this.messageHandler = callback;
    }
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    
    onStatus(callback) {
        this.statusHandler = callback;
    }
    
    notifyStatus(status, ...args) {
        if (this.statusHandler) {
            this.statusHandler(status, ...args);
        }
    }
} 