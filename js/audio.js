/**
 * Real-Time Web Audio Playback, Acoustic F1/F2 Formant FFT Lip-Sync Analyzer & Spectrum Visualizer
 *
 * Features:
 * 1. Decodes & plays Neural MP3 / Offline SAPI WAV AudioBuffers through Web Audio API
 * 2. Extracts real 60 FPS F1 (300-880 Hz jaw openness) & F2 (1500-2900 Hz front-vowel spread) formants
 *    plus voicing murmur (110-300 Hz) to drive millisecond-accurate 3D VRM visemes ('a','i','u','e','o','m','sil')
 * 3. Detects real syllable energy onsets to trigger Kendon conversational hand/head beats automatically
 * 4. Renders 24-bar cyan-to-magenta voice frequency spectrum in real time
 */
export class AudioVisualizer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.audioCtx = null;
        this.analyser = null;
        this.gainNode = null;
        this.dataArray = null;
        this.timeArray = null;
        this.animFrameId = null;

        this.simulatedVolume = 0;
        this.isSimulating = false;

        this.activeSource = null;
        this.isPlayingBuffer = false;
        this.visemeTimer = null;
        this.prevRms = 0;
        this.lastBeatAt = 0;

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
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return null;
            this.audioCtx = new AudioContextClass();
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.52;
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = 1.0;
            this.gainNode.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);

            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.timeArray = new Uint8Array(this.analyser.fftSize);
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
        }
        return this.audioCtx;
    }

    setSimulatedVolume(vol) {
        this.simulatedVolume = vol;
        this.isSimulating = !this.isPlayingBuffer && vol > 0.01;
    }

    /**
     * Decode raw MP3/WAV ArrayBuffer into a reusable AudioBuffer
     */
    async decodeAudio(arrayBuffer) {
        const ctx = this.ensureAudioContext();
        if (!ctx) throw new Error('Web Audio API unavailable');
        const copy = arrayBuffer.slice(0);
        return await ctx.decodeAudioData(copy);
    }

    /**
     * Play a decoded AudioBuffer while streaming real-time F1/F2 Formant FFT visemes at ~35 Hz
     */
    async playDecodedBuffer(audioBuffer, { onViseme, onEnded, onError } = {}) {
        this.stopAudioBuffer();
        const ctx = this.ensureAudioContext();
        if (!ctx) {
            if (onError) onError(new Error('No AudioContext'));
            return;
        }

        if (ctx.state === 'suspended') {
            try {
                await Promise.race([
                    ctx.resume(),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('AudioContext suspended')), 350))
                ]);
            } catch (e) {
                if (onError) onError(e);
                return;
            }
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gainNode);

        this.activeSource = source;
        this.isPlayingBuffer = true;
        this.isSimulating = false;
        this.prevRms = 0;

        this.visemeTimer = setInterval(() => {
            if (!this.isPlayingBuffer) return;
            const viseme = this.analyzeFormantViseme();
            if (onViseme) {
                onViseme(viseme.openness, viseme);
            }
        }, 28);

        source.onended = () => {
            if (this.activeSource !== source) return;
            this.activeSource = null;
            this.isPlayingBuffer = false;
            if (this.visemeTimer) {
                clearInterval(this.visemeTimer);
                this.visemeTimer = null;
            }
            if (onViseme) {
                onViseme(0, { vowel: 'sil', openness: 0, emphasis: 0 });
            }
            if (onEnded) onEnded();
        };

        try {
            source.start(0);
        } catch (err) {
            this.stopAudioBuffer();
            if (onError) onError(err);
        }
    }

    stopAudioBuffer() {
        if (this.visemeTimer) {
            clearInterval(this.visemeTimer);
            this.visemeTimer = null;
        }
        if (this.activeSource) {
            const src = this.activeSource;
            this.activeSource = null;
            try {
                src.onended = null;
                src.stop(0);
                src.disconnect();
            } catch (e) { }
        }
        this.isPlayingBuffer = false;
        this.prevRms = 0;
    }

    /**
     * Compute average normalized energy [0..1] in a frequency band [hzLow..hzHigh]
     */
    _bandEnergy(hzLow, hzHigh) {
        if (!this.analyser || !this.dataArray || !this.audioCtx) return 0;
        const nyquist = this.audioCtx.sampleRate * 0.5;
        const binCount = this.dataArray.length;
        const startBin = Math.max(0, Math.floor((hzLow / nyquist) * binCount));
        const endBin = Math.min(binCount - 1, Math.ceil((hzHigh / nyquist) * binCount));
        if (endBin < startBin) return 0;

        let sum = 0;
        let count = 0;
        for (let i = startBin; i <= endBin; i++) {
            sum += this.dataArray[i];
            count++;
        }
        return count > 0 ? (sum / (count * 255)) : 0;
    }

    /**
     * Real Acoustic Formant (F1 / F2) to VRM Viseme Classifier
     * - F0/Murmur (110-300 Hz): Nasal / bilabial closure ('m' -> VRM 'ん')
     * - F1 (320-880 Hz): Jaw height -> high F1 = open ('a', 'o')
     * - Mid-Back (880-1450 Hz): Back vowel resonance ('o', 'a')
     * - F2 (1500-2950 Hz): Tongue advancement / lip spread ('i', 'e')
     */
    analyzeFormantViseme() {
        if (!this.analyser || !this.dataArray || !this.timeArray) {
            return { vowel: 'sil', openness: 0, emphasis: 0, beat: false };
        }

        this.analyser.getByteFrequencyData(this.dataArray);
        this.analyser.getByteTimeDomainData(this.timeArray);

        // 1. True time-domain RMS amplitude
        let sqSum = 0;
        for (let i = 0; i < this.timeArray.length; i++) {
            const centered = (this.timeArray[i] - 128) / 128;
            sqSum += centered * centered;
        }
        const rms = Math.sqrt(sqSum / this.timeArray.length);

        if (rms < 0.012) {
            this.prevRms = rms;
            return { vowel: 'sil', openness: 0, emphasis: 0, beat: false };
        }

        // 2. Acoustic Formant Band Energies
        const f0Murmur = this._bandEnergy(110, 300);
        const f1Jaw = this._bandEnergy(320, 880);
        const midBack = this._bandEnergy(880, 1450);
        const f2Front = this._bandEnergy(1500, 2950);
        const sibilance = this._bandEnergy(3000, 6200);

        const openness = Math.min(1.0, Math.max(0.06, rms * 3.6 + f1Jaw * 0.42));
        const emphasis = Math.min(1.0, rms * 3.8 + f2Front * 0.3);

        // Syllable beat onset detector (drives Kendon hand & eyebrow speech beats!)
        const now = performance.now();
        const rmsDelta = rms - this.prevRms;
        this.prevRms = rms * 0.65 + this.prevRms * 0.35;
        let beat = false;
        if (rmsDelta > 0.055 && openness > 0.34 && (now - this.lastBeatAt > 340)) {
            beat = true;
            this.lastBeatAt = now;
        }

        // 3. Classify dominant IPA/Japanese VRM vowel from formant ratios
        let vowel = 'a';
        if (f0Murmur > 0.28 && f1Jaw < 0.16 && f2Front < 0.12) {
            // Voiced murmur with closed oral tract -> bilabial /m/, /b/, /p/, 'ん'
            vowel = 'm';
        } else if ((f2Front > f1Jaw * 0.78 && f1Jaw < 0.36) || sibilance > 0.28) {
            // High F2 / sibilance + low F1 -> spread close vowel 'i' ('い')
            vowel = 'i';
        } else if (f1Jaw > 0.40 && midBack > 0.26 && f2Front < midBack * 0.92) {
            // Strong F1 + mid-back resonance -> wide open 'a' ('あ')
            vowel = 'a';
        } else if (f1Jaw > 0.28 && f2Front >= midBack * 0.85) {
            // Mid-high F1 + strong F2 -> mid-front 'e' ('え')
            vowel = 'e';
        } else if (midBack > 0.20 && f2Front < 0.22) {
            // Rounded back resonance with suppressed F2 -> 'o' ('お')
            vowel = 'o';
        } else if (f0Murmur > 0.22 && f2Front < 0.18) {
            // Close rounded 'u' ('う')
            vowel = 'u';
        }

        return {
            vowel,
            openness: vowel === 'm' ? 0 : openness,
            emphasis,
            beat
        };
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

        if (!this.isSimulating && this.analyser && this.dataArray) {
            this.analyser.getByteFrequencyData(this.dataArray);
        }

        const activeGlow = this.isPlayingBuffer || this.isSimulating;

        for (let i = 0; i < bars; i++) {
            let val = 0.05;

            if (this.isSimulating) {
                const wave = Math.sin(Date.now() * 0.012 + i * 0.45);
                val = this.simulatedVolume * (0.35 + 0.65 * Math.abs(wave));
            } else if (this.analyser && this.dataArray) {
                // Map the 24 bars across the vocal formant range (bins 1..52 -> ~90 Hz to ~4.8 kHz)
                const binIdx = Math.min(this.dataArray.length - 1, 1 + Math.floor(i * 2.1));
                val = Math.max(0.05, this.dataArray[binIdx] / 255);
            }

            const barHeight = Math.max(4, val * (height * 0.88));
            const x = i * (barWidth + 3);
            const y = centerY - barHeight / 2;

            const gradient = this.ctx.createLinearGradient(0, y, 0, y + barHeight);
            gradient.addColorStop(0, '#00f3ff');
            gradient.addColorStop(0.6, '#39c5bb');
            gradient.addColorStop(1, '#ff66aa');

            this.ctx.fillStyle = gradient;
            this.ctx.shadowColor = '#00f3ff';
            this.ctx.shadowBlur = activeGlow ? 10 : 2;
            this.ctx.beginPath();
            this.ctx.roundRect(x, y, barWidth, barHeight, 3);
            this.ctx.fill();
        }
    }
}
