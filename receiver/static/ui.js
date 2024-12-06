class UI {
    constructor() {
        this.elements = this.initializeElements();
        this.setupEventListeners();
        this.initializeDisplays();
    }
    
    initializeElements() {
        const elements = {
            serialStatus: document.getElementById('serial-status'),
            wsStatus: document.getElementById('ws-status'),
            serialPortsSelect: document.getElementById('serial-ports'),
            connectBtn: document.getElementById('connect-btn'),
            scanBtn: document.getElementById('scan-btn'),
            tareBtn: document.getElementById('tare-btn'),
            resetBtn: document.getElementById('reset-btn'),
            avgWindow: document.getElementById('avg-window'),
            avgEnabled: document.getElementById('avg-enabled'),
            displays: {
                currentPosition: document.getElementById('current-position'),
                currentTimestampDrift: document.getElementById('current-timestamp-drift'),
                currentAmplitude: document.getElementById('current-amplitude'),
                currentPeriod: document.getElementById('current-period'),
                positivePeriod: document.getElementById('positive-period'),
                negativePeriod: document.getElementById('negative-period'),
                positivePeak: document.getElementById('positive-peak'),
                negativePeak: document.getElementById('negative-peak'),
                currentTemperatureBMP180: document.getElementById('current-temperature-bmp180'),
                currentTemperatureSHT85: document.getElementById('current-temperature-sht85'),
                currentPressure: document.getElementById('current-pressure'),
                currentHumidity: document.getElementById('current-humidity')
            }
        };

        // Initialize the averaging controls state
        const avgWindowLabel = document.getElementById('avg-window-label');
        elements.avgWindow.disabled = !elements.avgEnabled.checked;
        if (!elements.avgEnabled.checked) {
            avgWindowLabel.classList.add('disabled');
        }

        return elements;
    }
    
    initializeDisplays() {
        Object.values(this.elements.displays).forEach(element => {
            element.textContent = '0';
        });
        this.elements.displays.currentPeriod.textContent = '0.0s';
        this.elements.displays.positivePeriod.textContent = '0.0s';
        this.elements.displays.negativePeriod.textContent = '0.0s';
    }
    
    setupEventListeners() {
        // Get the averaging checkbox and window elements
        const avgEnabled = document.getElementById('avg-enabled');
        const avgWindow = this.elements.avgWindow;
        const avgWindowLabel = document.getElementById('avg-window-label');

        // Add event listener for the averaging window input
        avgWindow.addEventListener('change', () => {
            // Event will be handled by plots manager
            const event = new CustomEvent('averaging-window-changed', {
                detail: { window: this.getAveragingWindow() }
            });
            window.dispatchEvent(event);
        });

        // Add event listener for the checkbox
        avgEnabled.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            avgWindow.disabled = !isEnabled;
            
            // Add/remove a class to style the disabled state
            if (isEnabled) {
                avgWindowLabel.classList.remove('disabled');
            } else {
                avgWindowLabel.classList.add('disabled');
            }
        });
    }
    
    onConnect(callback) {
        this.elements.connectBtn.addEventListener('click', callback);
    }
    
    onScan(callback) {
        this.elements.scanBtn.addEventListener('click', callback);
    }
    
    onTare(callback) {
        this.elements.tareBtn.addEventListener('click', callback);
    }
    
    onReset(callback) {
        this.elements.resetBtn.addEventListener('click', callback);
    }
    
    getPortSelection() {
        return this.elements.serialPortsSelect.value;
    }
    
    getAveragingWindow() {
        const value = parseInt(this.elements.avgWindow.value);
        return isNaN(value) || value < 1 ? 1 : value;
    }
    
    updateDisplays(data) {
        const displays = this.elements.displays;
        displays.currentTimestampDrift.textContent = `${data.getCurrentTimestampDrift()} μs`;
        displays.currentPosition.textContent = `${data.getCurrentPosition().toFixed(0)}°`;
        displays.currentAmplitude.textContent = `${data.getCurrentAmplitude().toFixed(2)}°`;
        displays.currentPeriod.textContent = `${data.getCurrentPeriod().toFixed(6)}s`;
        displays.positivePeriod.textContent = `${data.getPositiveHalfperiod().toFixed(6)}s`;
        displays.negativePeriod.textContent = `${data.getNegativeHalfperiod().toFixed(6)}s`;
        displays.positivePeak.textContent = `+${data.getPositiveAmplitude().toFixed(2)}°`;
        displays.negativePeak.textContent = `${data.getNegativeAmplitude().toFixed(2)}°`;
        displays.currentTemperatureBMP180.textContent = `${data.getCurrentBMP180Temperature().toFixed(2)} °C`;
        displays.currentTemperatureSHT85.textContent = `${data.getCurrentSHT85Temperature().toFixed(2)} °C`;
        displays.currentPressure.textContent = `${data.getCurrentBMP180Pressure().toFixed(2)} hPa`;
        displays.currentHumidity.textContent = `${data.getCurrentSHT85Humidity().toFixed(2)} %`;
    }
    
    updateSerialPorts(ports) {
        this.elements.serialPortsSelect.innerHTML = '';
        ports.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = port;
            this.elements.serialPortsSelect.appendChild(option);
        });
    }
    
    updateSerialStatus(status, isError = false) {
        this.elements.serialStatus.textContent = status;
        this.elements.serialStatus.className = isError ? 'status-error' : 'status-success';
    }
    
    updateWebSocketStatus(status, isError = false) {
        this.elements.wsStatus.textContent = status;
        this.elements.wsStatus.className = isError ? 'status-error' : 'status-success';
    }
} 