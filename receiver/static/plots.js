class Plots {
    constructor() {
        this.initializePlots();
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

        // Computed measurements
        createPlot('period-chart', [], [],
            'Period', 'Time (s)', 'Period (s)');
        createPlot('amplitude-chart', [], [],
            'Amplitude', 'Time (s)', 'Amplitude (degrees)');
        createPlot('amplitude-rate-chart', [], [],
            'Rate of Change of Amplitude', 'Time (s)', 'Amplitude Rate (degrees/s)');
        createPlot('amplitude-period-chart', [], [],
            'Amplitude vs Period', 'Amplitude (degrees)', 'Period (s)', 'markers');

        // Averaged measurements
        createPlot('period-chart-avg', [], [],
            'Period (Averaged)', 'Time (s)', 'Period (s)');
        createPlot('amplitude-chart-avg', [], [],
            'Amplitude (Averaged)', 'Time (s)', 'Amplitude (degrees)');
        createPlot('amplitude-rate-chart-avg', [], [],
            'Rate of Change of Amplitude (Averaged)', 'Time (s)', 'Amplitude Rate (degrees/s)');
        createPlot('amplitude-period-chart-avg', [], [],
            'Amplitude vs Period (Averaged)', 'Amplitude (degrees)', 'Period (s)', 'markers');
    }

    updateAll(data) {
        const smoothedVelocities = this.movingAverage(data.velocities, data.smoothingWindow);
        const smoothedAccelerations = this.movingAverage(data.accelerations, data.smoothingWindow);

        const avgWindow = document.getElementById('avg-window').value;
        const avgAmplitude = this.movingAverage(data.amplitudeData, avgWindow);
        const avgPeriod = this.movingAverage(data.periodData, avgWindow);
        const avgAmplitudeRate = this.movingAverage(data.amplitudeRateData, avgWindow);

        const updates = [
            { id: 'position-chart', y: data.counts, x: data.timestamps },
            { id: 'velocity-chart', y: smoothedVelocities, x: data.timestamps },
            { id: 'acceleration-chart', y: smoothedAccelerations, x: data.timestamps },
            { id: 'period-chart', y: data.periodData, x: data.periodTimestamps },
            { id: 'amplitude-chart', y: data.amplitudeData, x: data.amplitudeTimestamps },
            { id: 'amplitude-rate-chart', y: data.amplitudeRateData, x: data.amplitudeRateTimestamps },
            { id: 'amplitude-period-chart', y: data.periodData, x: data.amplitudeData },
            { id: 'period-chart-avg', y: avgPeriod, x: data.periodTimestamps },
            { id: 'amplitude-chart-avg', y: avgAmplitude, x: data.amplitudeTimestamps },
            { id: 'amplitude-rate-chart-avg', y: avgAmplitudeRate, x: data.amplitudeRateTimestamps },
            { id: 'amplitude-period-chart-avg', y: avgPeriod, x: avgAmplitude },
            { id: 'position-velocity-chart', y: smoothedVelocities, x: data.counts },
        ];

        updates.forEach(({ id, x, y }) => {
            Plotly.update(id, {
                x: [x],
                y: [y]
            }).catch(error => {
                console.error(`Error updating ${id}:`, error);
            });
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
} 