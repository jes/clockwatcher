class UI {
    constructor() {
        this.elements = this.initializeElements();

        // Initialize datetime inputs with reasonable defaults
        this.setTimeRange('1h'); // Default to last hour
        
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
                currentTemperatureBMP390: document.getElementById('current-temperature-bmp390'),
                currentTemperatureSHT85: document.getElementById('current-temperature-sht85'),
                currentPressure: document.getElementById('current-pressure'),
                currentPressureBMP390: document.getElementById('current-pressure-bmp390'),
                currentHumidity: document.getElementById('current-humidity')
            },
            modeControls: {
                liveMode: document.querySelector('input[value="live"]'),
                historicalMode: document.querySelector('input[value="historical"]'),
                timeBounds: document.querySelector('.time-bounds'),
                timePresets: document.querySelector('.time-presets'),
                customInputs: document.querySelector('.custom-time-inputs'),
                startTime: document.getElementById('start-time'),
                endTime: document.getElementById('end-time'),
                loadButton: document.getElementById('load-data')
            },
            chartGroups: {
                raw: document.querySelector('.chart-group:nth-child(1)'),
                environmental: document.querySelector('.chart-group:nth-child(2)'),
                analysis: document.querySelector('.chart-group:nth-child(3)')
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
            if (this.onAveragingWindowChange) {
                this.onAveragingWindowChange();
            }
        });

        // Add event listener for the checkbox
        avgEnabled.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            avgWindow.disabled = !isEnabled;
            
            if (isEnabled) {
                avgWindowLabel.classList.remove('disabled');
            } else {
                avgWindowLabel.classList.add('disabled');
            }

            if (this.onAveragingWindowChange) {
                this.onAveragingWindowChange();
            }
        });

        // Add mode switching listeners
        this.elements.modeControls.liveMode.addEventListener('change', () => this.handleModeChange('live'));
        this.elements.modeControls.historicalMode.addEventListener('change', () => this.handleModeChange('historical'));
        this.elements.modeControls.loadButton.addEventListener('click', () => this.handleLoadHistoricalData());

        // Add time preset handlers
        this.elements.modeControls.timePresets.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                const period = e.target.dataset.period;
                if (period === 'custom') {
                    this.elements.modeControls.customInputs.style.display = 'block';
                } else {
                    this.elements.modeControls.customInputs.style.display = 'none';
                    this.setTimeRange(period);
                    this.handleLoadHistoricalData();
                }
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
        displays.currentTemperatureBMP390.textContent = `${data.getCurrentBMP390Temperature().toFixed(2)} °C`;
        displays.currentTemperatureSHT85.textContent = `${data.getCurrentSHT85Temperature().toFixed(2)} °C`;
        displays.currentPressure.textContent = `${data.getCurrentBMP180Pressure().toFixed(2)} hPa`;
        displays.currentPressureBMP390.textContent = `${data.getCurrentBMP390Pressure().toFixed(2)} hPa`;
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

    handleModeChange(mode) {
        // Show/hide time bounds controls
        this.elements.modeControls.timeBounds.style.display = mode === 'historical' ? 'block' : 'none';
        if (mode === 'historical') {
            this.elements.modeControls.customInputs.style.display = 'none';
        }

        // Show/hide position, velocity, acceleration
        const liveOnlyCharts = ['position-chart', 'velocity-chart', 'acceleration-chart'].map(id => document.querySelector(`#${id}`));
        liveOnlyCharts.forEach(chart => {
            if (chart) {
                chart.style.display = mode === 'live' ? 'block' : 'none';
            }
        });

        // Emit event for mode change
        if (this.onModeChange) {
            this.onModeChange(mode);
        }
    }

    handleLoadHistoricalData() {
        // microseconds
        const startTime = new Date(this.elements.modeControls.startTime.value).getTime() * 1000;
        const endTime = new Date(this.elements.modeControls.endTime.value).getTime() * 1000;

        if (this.onLoadHistoricalData) {
            this.onLoadHistoricalData(startTime, endTime);
        }
    }

    formatDateTime(date) {
        return date.toISOString().slice(0, 19); // Format as YYYY-MM-DDTHH:mm:ss
    }

    onModeChange(callback) {
        this.onModeChange = callback;
    }

    onLoadHistoricalData(callback) {
        this.onLoadHistoricalData = callback;
    }

    setTimeRange(period) {
        const now = new Date();
        let startTime;

        switch (period) {
            case '1h':
                startTime = new Date(now - 60 * 60 * 1000);
                break;
            case '24h':
                startTime = new Date(now - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                return;
        }

        this.elements.modeControls.startTime.value = this.formatDateTime(startTime);
        this.elements.modeControls.endTime.value = this.formatDateTime(now);
    }

    onAveragingWindowChange(callback) {
        this.onAveragingWindowChange = callback;
    }
} 