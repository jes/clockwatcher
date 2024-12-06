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
            amplitudeRateData: 0,
            temperatureData: 0,
            pressureData: 0,
            humidityData: 0
        };

        this.plotStates = {};
    }

    initializePlots() {
        const createPlot = ({ elementId, title, xAxisTitle, yAxisTitle, mode = 'lines', names = [title] }) => {
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

            const traces = names.map(name => ({
                x: [],
                y: [],
                mode,
                name
            }));

            Plotly.newPlot(elementId, traces, layout, { 
                responsive: true, 
                displayModeBar: false 
            });
        };

        // Initialize all plots with empty data
        this.createAllPlots(createPlot);
    }

    createAllPlots(createPlot) {
        // Raw measurements
        createPlot({
            elementId: 'position-chart',
            title: 'Balance wheel position',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Position (degrees)'
        });
        
        createPlot({
            elementId: 'position-velocity-chart',
            title: 'Position vs Velocity',
            xAxisTitle: 'Position (degrees)',
            yAxisTitle: 'Velocity (degrees/s)'
        });
        
        createPlot({
            elementId: 'velocity-chart',
            title: 'Balance wheel velocity',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Velocity (degrees/s)'
        });
        createPlot({
            elementId: 'acceleration-chart',
            title: 'Balance wheel acceleration',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Acceleration (degrees/s²)'
        });

        createPlot({
            elementId: 'timestamp-drift-chart',
            title: 'Timestamp Drift',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Drift (μs)'
        });

        // Averaged measurements
        createPlot({
            elementId: 'period-chart-avg',
            title: 'Period',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Period (s)'
        });
        createPlot({
            elementId: 'amplitude-chart-avg',
            title: 'Amplitude',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Amplitude (degrees)'
        });
        createPlot({
            elementId: 'amplitude-rate-chart-avg',
            title: 'Rate of Change of Amplitude',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Amplitude Rate (degrees/s)'
        });
        createPlot({
            elementId: 'amplitude-period-chart-avg',
            title: 'Amplitude vs Period',
            xAxisTitle: 'Amplitude (degrees)',
            yAxisTitle: 'Period (s)',
            mode: 'markers'
        });

        // Environmental measurements
        createPlot({
            elementId: 'temperature-chart',
            title: 'Temperature',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Temperature (°C)',
            mode: 'lines',
            names: ['BMP180', 'SHT85']
        });
        createPlot({
            elementId: 'pressure-chart',
            title: 'Pressure',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Pressure (hPa)'
        });
        createPlot({
            elementId: 'humidity-chart',
            title: 'Humidity',
            xAxisTitle: 'Time (s)',
            yAxisTitle: 'Humidity (%)'
        });
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
            { 
                id: 'position-chart', 
                x: [data.timestamps], 
                y: [data.counts] 
            },
            { 
                id: 'velocity-chart', 
                x: [data.timestamps], 
                y: [this.avgVelocities] 
            },
            { 
                id: 'acceleration-chart', 
                x: [data.timestamps], 
                y: [this.avgAccelerations] 
            },
            { 
                id: 'period-chart-avg', 
                x: [data.periodTimestamps], 
                y: [this.avgPeriod] 
            },
            { 
                id: 'amplitude-chart-avg', 
                x: [data.amplitudeTimestamps], 
                y: [this.avgAmplitude] 
            },
            { 
                id: 'amplitude-rate-chart-avg', 
                x: [data.amplitudeRateTimestamps], 
                y: [this.avgAmplitudeRate] 
            },
            { 
                id: 'amplitude-period-chart-avg', 
                x: [this.avgAmplitude], 
                y: [this.avgPeriod] 
            },
            { 
                id: 'position-velocity-chart', 
                x: [data.counts], 
                y: [this.avgVelocities] 
            },
            { 
                id: 'temperature-chart', 
                x: [data.bmp180Timestamps, data.sht85Timestamps], 
                y: [data.bmp180Temperatures, data.sht85Temperatures],
            },
            { 
                id: 'pressure-chart', 
                x: [data.bmp180Timestamps], 
                y: [data.bmp180Pressures] 
            },
            { 
                id: 'humidity-chart', 
                x: [data.sht85Timestamps], 
                y: [data.sht85Humidities] 
            },
            { 
                id: 'timestamp-drift-chart', 
                x: [data.timestamps], 
                y: [data.timestampDrifts] 
            }
        ];

        updates.forEach(({ id, x, y }) => {
            let haveReset = false;
            if (!this.plotStates[id]) {
                haveReset = true;
                this.plotStates[id] = {
                    lastLength: Array(x.length).fill(0),
                    lastX: Array(x.length).fill(null),
                    lastY: Array(x.length).fill(null)
                };
            }

            const state = this.plotStates[id];
            const hasNewData = y.some((trace, i) => trace.length !== state.lastLength[i]);
            const lastPointChanged = y.some((trace, i) => 
                (trace.length > 0 && state.lastY[i] !== trace[trace.length - 1]) ||
                (x[i].length > 0 && state.lastX[i] !== x[i][x[i].length - 1])
            );

            if (haveReset || hasNewData || lastPointChanged) {
                Plotly.update(id, { x, y }).catch(error => {
                    console.error(`Error updating ${id}:`, error);
                });

                // Update state
                state.lastLength = y.map(trace => trace.length);
                state.lastX = x.map(trace => trace.length > 0 ? trace[trace.length - 1] : null);
                state.lastY = y.map(trace => trace.length > 0 ? trace[trace.length - 1] : null);
            }
        });
    }
} 