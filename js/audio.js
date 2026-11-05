/**
 * Audio Spectrum Visualizer & Audio Context Manager
 */
export class AudioVisualizer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.audioCtx = null;
        this.analyser = null;
        this.dataArray = null;
        this.animFrameId = null;
        this.simulatedVolume = 0;
        this.isSimulating = false;

        this.init();
    }

    init() {
        if (!this.canvas) return;
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.startRenderLoop();
    }

    resize() {
        if (!this.canvas) return;
        this.canvas.width = this.canvas.offsetWidth * window.devicePixelRatio || 300;
        this.canvas.height = this.canvas.offsetHeight * window.devicePixelRatio || 60;
    }

    ensureAudioContext() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 64;
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    setSimulatedVolume(vol) {
        this.simulatedVolume = vol;
        this.isSimulating = vol > 0.01;
    }

    startRenderLoop() {
        const render = () => {
            this.draw();
            this.animFrameId = requestAnimationFrame(render);
        };
        render();
    }

    draw() {
        if (!this.ctx || !this.canvas) return;

        const width = this.canvas.width;
        const height = this.canvas.height;
        this.ctx.clearRect(0, 0, width, height);

        const bars = 24;
        const barWidth = (width / bars) - 3;
        const centerY = height / 2;

        for (let i = 0; i < bars; i++) {
            let val = 0.05;

            if (this.isSimulating) {
                // Harmonic sine fluctuation for lively visualizer bars
                const wave = Math.sin(Date.now() * 0.012 + i * 0.45);
                val = this.simulatedVolume * (0.35 + 0.65 * Math.abs(wave));
            } else if (this.analyser && this.dataArray) {
                this.analyser.getByteFrequencyData(this.dataArray);
                val = (this.dataArray[i % this.dataArray.length] / 255);
            }

            const barHeight = Math.max(4, val * (height * 0.85));
            const x = i * (barWidth + 3);
            const y = centerY - barHeight / 2;

            // Gradient cyan to pink Miku palette
            const gradient = this.ctx.createLinearGradient(0, y, 0, y + barHeight);
            gradient.addColorStop(0, '#00f3ff');
            gradient.addColorStop(0.6, '#39c5bb');
            gradient.addColorStop(1, '#ff66aa');

            this.ctx.fillStyle = gradient;
            this.ctx.shadowColor = '#00f3ff';
            this.ctx.shadowBlur = this.isSimulating ? 10 : 2;
            this.ctx.beginPath();
            this.ctx.roundRect(x, y, barWidth, barHeight, 3);
            this.ctx.fill();
        }
    }
}

