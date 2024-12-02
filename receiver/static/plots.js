class Plots {
    constructor() {
        this.initializePlots();
        this.reset();
        this.lastAvgWindow = null;
        this.plotStates = {};
    }

    reset() {
        // Store the averaged arrays
        this.avgVelocities = [];
        this.avgAccelerations = [];
        this.avgAmplitude = [];
        this.avgPeriod = [];
        this.avgAmplitudeRate = [];
        this.lastAvgWindow = null;
        
        // Store previous lengths to detect resets
        this.prevLengths = {
            velocities: 0,
            accelerations: 0,
            amplitudeData: 0,
            periodData: 0,
            amplitudeRateData: 0
        };

        this.plotStates = {};
    }

    updateMovingAverage(array, prevArray, window, prevLength) {
        if (array.length < prevLength) {
            // Data was reset, recalculate entire array
            return this.movingAverage(array, window);
        }
        
        // Only calculate new points
        for (let i = prevLength; i < array.length; i++) {
            if (i < window - 1) continue;
            
            let sum = 0;
            for (let j = i - window + 1; j <= i; j++) {
                sum += array[j];
            }
            prevArray.push(sum / window);
        }
        
        return prevArray;
    }

    updateAll(data) {
        // Update moving averages incrementally
        this.avgVelocities = this.updateMovingAverage(
            data.velocities, 
            this.avgVelocities, 
            data.smoothingWindow, 
            this.prevLengths.velocities
        );
        
        this.avgAccelerations = this.updateMovingAverage(
            data.accelerations, 
            this.avgAccelerations, 
            data.smoothingWindow, 
            this.prevLengths.accelerations
        );

        let avgWindow = document.getElementById('avg-window').value;
        const isAveragingEnabled = document.getElementById('avg-enabled').checked;
        if (!isAveragingEnabled) {
            avgWindow = 1;
        }

        // If window size changed, force recalculation
        if (avgWindow !== this.lastAvgWindow) {
            this.avgAmplitude = this.movingAverage(data.amplitudeData, avgWindow);
            this.avgPeriod = this.movingAverage(data.periodData, avgWindow);
            this.avgAmplitudeRate = this.movingAverage(data.amplitudeRateData, avgWindow);
            this.lastAvgWindow = avgWindow;
        } else {
            this.avgAmplitude = this.updateMovingAverage(
                data.amplitudeData, 
                this.avgAmplitude, 
                avgWindow, 
                this.prevLengths.amplitudeData
            );
            
            this.avgPeriod = this.updateMovingAverage(
                data.periodData, 
                this.avgPeriod, 
                avgWindow, 
                this.prevLengths.periodData
            );
            
            this.avgAmplitudeRate = this.updateMovingAverage(
                data.amplitudeRateData, 
                this.avgAmplitudeRate, 
                avgWindow, 
                this.prevLengths.amplitudeRateData
            );
        }

        // Update previous lengths
        this.prevLengths = {
            velocities: data.velocities.length,
            accelerations: data.accelerations.length,
            amplitudeData: data.amplitudeData.length,
            periodData: data.periodData.length,
            amplitudeRateData: data.amplitudeRateData.length
        };

        const updates = [
            { id: 'position-chart', y: data.counts, x: data.timestamps },
            { id: 'velocity-chart', y: this.avgVelocities, x: data.timestamps },
            { id: 'acceleration-chart', y: this.avgAccelerations, x: data.timestamps },
            { id: 'period-chart-avg', y: this.avgPeriod, x: data.periodTimestamps },
            { id: 'amplitude-chart-avg', y: this.avgAmplitude, x: data.amplitudeTimestamps },
            { id: 'amplitude-rate-chart-avg', y: this.avgAmplitudeRate, x: data.amplitudeRateTimestamps },
            { id: 'amplitude-period-chart-avg', y: this.avgPeriod, x: this.avgAmplitude },
            { id: 'position-velocity-chart', y: this.avgVelocities, x: data.counts },
            { id: 'temperature-chart', y: data.temperatures, x: data.environmentalTimestamps },
            { id: 'pressure-chart', y: data.pressures, x: data.environmentalTimestamps },
        ];

        updates.forEach(({ id, x, y }) => {
            // Initialize state object for this plot if it doesn't exist
            if (!this.plotStates[id]) {
                this.plotStates[id] = {
                    lastLength: 0,
                    lastX: null,
                    lastY: null
                };
            }

            const state = this.plotStates[id];
            const hasNewData = y.length !== state.lastLength;
            const lastPointChanged = 
                (y.length > 0 && state.lastY !== y[y.length - 1]) ||
                (x.length > 0 && state.lastX !== x[x.length - 1]);

            if (hasNewData || lastPointChanged) {
                Plotly.update(id, {
                    x: [x],
                    y: [y]
                }).catch(error => {
                    console.error(`Error updating ${id}:`, error);
                });

                // Update state
                state.lastLength = y.length;
                state.lastX = x.length > 0 ? x[x.length - 1] : null;
                state.lastY = y.length > 0 ? y[y.length - 1] : null;
            }
        });
    }

    initializePlots() {
        const createPlot = (elementId, x, y, title, xAxisTitle, yAxisTitle, mode = 'lines') => {
            const layout = {
                autosize: true,
                responsive: true,
                margin: { l: 50, r: 50, t: 40, b: 40 },
                width: null,
                height: 400,
                title,
                xaxis: { title: xAxisTitle },
                yaxis: { title: yAxisTitle }
            };

            Plotly.newPlot(elementId, [{
                x, y, mode,
                name: title
            }], layout, { responsive: true, displayModeBar: false });
        };

        // Initialize all plots with empty data
        this.createAllPlots(createPlot);
    }

    createAllPlots(createPlot) {
        // Raw measurements
        createPlot('position-chart', [], [], 
            'Balance wheel position', 'Time (s)', 'Position (degrees)');
        createPlot('position-velocity-chart', [], [],
            'Position vs Velocity', 'Position (degrees)', 'Velocity (degrees/s)');
        createPlot('velocity-chart', [], [],
            'Balance wheel velocity', 'Time (s)', 'Velocity (degrees/s)');
        createPlot('acceleration-chart', [], [],
            'Balance wheel acceleration', 'Time (s)', 'Acceleration (degrees/s²)');

        // Averaged measurements
        createPlot('period-chart-avg', [], [],
            'Period (Averaged)', 'Time (s)', 'Period (s)');
        createPlot('amplitude-chart-avg', [], [],
            'Amplitude (Averaged)', 'Time (s)', 'Amplitude (degrees)');
        createPlot('amplitude-rate-chart-avg', [], [],
            'Rate of Change of Amplitude (Averaged)', 'Time (s)', 'Amplitude Rate (degrees/s)');
        createPlot('amplitude-period-chart-avg', [], [],
            'Amplitude vs Period (Averaged)', 'Amplitude (degrees)', 'Period (s)', 'markers');

        // Environmental measurements
        createPlot('temperature-chart', [], [],
            'Temperature', 'Time (s)', 'Temperature (°C)');
        createPlot('pressure-chart', [], [],
            'Pressure', 'Time (s)', 'Pressure (hPa)');
    }

    movingAverage(array, window) {
        if (window <= 1) return array;
        
        const result = [];
        // Skip the first (window-1) points
        for (let i = window - 1; i < array.length; i++) {
            let sum = 0;
            for (let j = i - window + 1; j <= i; j++) {
                sum += array[j];
            }
            result.push(sum / window);
        }
        return result;
    }
} 