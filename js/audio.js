/**
 * Bulletproof Dual-Path Web Audio + HTMLAudioElement Playback, Loudness Boost, Speaker Routing & F1/F2 FFT Lip-Sync
 *
 * Reliability & Audibility Guarantees:
 * 1. Hardware Unlock Pulse (`unlockAudioHardware`): Plays a 1-frame silent buffer during user gesture so Chrome/Edge
 *    immediately wake up the physical audio output endpoint (`ctx.state === 'running'`).
 * 2. Vocal Presence Compressor + Boost (`DynamicsCompressorNode` + `1.5x` default Gain): Makes Miku's voice clear,
 *    warm, and audible even on quiet laptop/USB speakers.
 * 3. Output Speaker Sink Routing (`setOutputDevice` via `AudioContext.setSinkId` & `HTMLAudioElement.setSinkId`):
 *    Allows routing audio directly to USB Headset / Realtek Speakers if Windows Default points to a silent monitor!
 * 4. Guaranteed HTMLAudioElement Fallback: If WebAudio `AudioContext` is ever suspended or fails decoding,
 *    automatically plays the MP3/WAV Blob through a native `<audio>` element while driving smooth visemes!
 */
export class AudioVisualizer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.audioCtx = null;
        this.analyser = null;
        this.compressor = null;
        this.gainNode = null;
        this.dataArray = null;
        this.timeArray = null;
        this.animFrameId = null;

        const savedVol = (typeof localStorage !== 'undefined' && localStorage.getItem('miku_voice_volume')) || '1.5';
        this.volumeBoost = Math.max(0.2, Math.min(2.5, parseFloat(savedVol) || 1.5));
        this.sinkId = (typeof localStorage !== 'undefined' && localStorage.getItem('miku_audio_sink_id')) || '';

        this.simulatedVolume = 0;
        this.isSimulating = false;

        this.activeSource = null;
        this.activeAudioEl = null;
        this.activeBlobUrl = null;
        this.isPlayingBuffer = false;
        this.visemeTimer = null;
        this.prevRms = 0;
        this.lastBeatAt = 0;
        this.unlockedOnce = false;

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

    setVolumeBoost(val) {
        this.volumeBoost = Math.max(0.2, Math.min(2.5, parseFloat(val) || 1.5));
        if (typeof localStorage !== 'undefined') localStorage.setItem('miku_voice_volume', String(this.volumeBoost));
        if (this.gainNode && this.audioCtx) {
            this.gainNode.gain.setValueAtTime(this.volumeBoost, this.audioCtx.currentTime);
        }
    }

    async setOutputDevice(deviceId) {
        this.sinkId = deviceId || '';
        if (typeof localStorage !== 'undefined') localStorage.setItem('miku_audio_sink_id', this.sinkId);
        if (this.audioCtx && typeof this.audioCtx.setSinkId === 'function') {
            try {
                await this.audioCtx.setSinkId(this.sinkId);
            } catch (e) {
                console.warn('[Audio] AudioContext.setSinkId unsupported/failed:', e.message);
            }
        }
        if (this.activeAudioEl && typeof this.activeAudioEl.setSinkId === 'function') {
            try {
                await this.activeAudioEl.setSinkId(this.sinkId);
            } catch (e) {}
        }
    }

    async listOutputDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'audiooutput');
        } catch (e) {
            return [];
        }
    }

    ensureAudioContext() {
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return null;
            this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });

            // Vocal presence compressor + adjustable loudness boost -> Analyser -> Destination
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = this.volumeBoost;

            this.compressor = this.audioCtx.createDynamicsCompressor();
            this.compressor.threshold.value = -18;
            this.compressor.knee.value = 18;
            this.compressor.ratio.value = 3.5;
            this.compressor.attack.value = 0.003;
            this.compressor.release.value = 0.18;

            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.52;

            this.gainNode.connect(this.compressor);
            this.compressor.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);

            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.timeArray = new Uint8Array(this.analyser.fftSize);

            if (this.sinkId && typeof this.audioCtx.setSinkId === 'function') {
                this.audioCtx.setSinkId(this.sinkId).catch(() => {});
            }
        }

        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
        }

        // Play a 1-sample silent pulse on first user gesture so hardware audio endpoint wakes up immediately
        if (!this.unlockedOnce && this.audioCtx) {
            try {
                const silent = this.audioCtx.createBuffer(1, 1, 22050);
                const src = this.audioCtx.createBufferSource();
                src.buffer = silent;
                src.connect(this.audioCtx.destination);
                src.start(0);
                this.unlockedOnce = true;
            } catch (e) {}
        }

        return this.audioCtx;
    }

    /**
     * Play a pleasant, clearly audible 2-note Miku cyan chime to test physical speaker output immediately!
     */
    async playTestChime() {
        const ctx = this.ensureAudioContext();
        if (!ctx) return false;
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }
        const now = ctx.currentTime;
        const notes = [587.33, 880.0]; // D5 -> A5 bright chime
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.11);
            g.gain.setValueAtTime(0.001, now + idx * 0.11);
            g.gain.exponentialRampToValueAtTime(0.28 * Math.min(2.0, this.volumeBoost), now + idx * 0.11 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 0.28);
            osc.connect(g);
            g.connect(this.analyser);
            osc.start(now + idx * 0.11);
            osc.stop(now + idx * 0.11 + 0.30);
        });
        return ctx.state === 'running';
    }

    setSimulatedVolume(vol) {
        this.simulatedVolume = vol;
        this.isSimulating = !this.isPlayingBuffer && vol > 0.01;
    }

    async decodeAudio(arrayBuffer) {
        const ctx = this.ensureAudioContext();
        if (!ctx) throw new Error('Web Audio API unavailable');
        const copy = arrayBuffer.slice(0);
        return await ctx.decodeAudioData(copy);
    }

    /**
     * Play audio payload to completion (Promise resolves ONLY when utterance finishes playing!).
     * Tries WebAudio BufferSource (with real F1/F2 FFT Lip-Sync) first; falls back automatically to `<audio>` element!
     */
    playAudioPayload({ audioBuffer, blobUrl, text = '' }, { onViseme } = {}) {
        return new Promise(async (resolve, reject) => {
            this.stopAudioBuffer();
            const ctx = this.ensureAudioContext();

            if (ctx && ctx.state === 'suspended') {
                try {
                    await Promise.race([
                        ctx.resume(),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('AudioContext suspended')), 500))
                    ]);
                } catch (e) {
                    // Fall through to HTMLAudioElement path below!
                }
            }

            // Path A: WebAudio AudioBufferSourceNode + Real 60 FPS F1/F2 Formant FFT Lip-Sync
            if (ctx && ctx.state === 'running' && audioBuffer) {
                try {
                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    this.gainNode.gain.setValueAtTime(this.volumeBoost, ctx.currentTime);
                    source.connect(this.gainNode);

                    this.activeSource = source;
                    this.isPlayingBuffer = true;
                    this.isSimulating = false;
                    this.prevRms = 0;

                    this.visemeTimer = setInterval(() => {
                        if (!this.isPlayingBuffer) return;
                        const viseme = this.analyzeFormantViseme();
                        if (onViseme) onViseme(viseme.openness, viseme);
                    }, 28);

                    source.onended = () => {
                        if (this.activeSource !== source) {
                            resolve(false);
                            return;
                        }
                        this.activeSource = null;
                        this.isPlayingBuffer = false;
                        if (this.visemeTimer) {
                            clearInterval(this.visemeTimer);
                            this.visemeTimer = null;
                        }
                        if (onViseme) onViseme(0, { vowel: 'sil', openness: 0, emphasis: 0 });
                        resolve(true);
                    };

                    source.start(0);
                    return;
                } catch (err) {
                    console.warn('[Audio] BufferSource failed, trying HTMLAudioElement:', err.message);
                }
            }

            // Path B: Guaranteed Native HTMLAudioElement Fallback
            if (blobUrl) {
                try {
                    const audioEl = new Audio(blobUrl);
                    audioEl.volume = Math.min(1.0, this.volumeBoost * 0.85);
                    if (this.sinkId && typeof audioEl.setSinkId === 'function') {
                        try { await audioEl.setSinkId(this.sinkId); } catch (e) {}
                    }
                    this.activeAudioEl = audioEl;
                    this.isPlayingBuffer = true;
                    const startT = performance.now();
                    const vowels = ['a', 'e', 'i', 'o', 'u'];

                    this.visemeTimer = setInterval(() => {
                        if (!this.activeAudioEl || this.activeAudioEl.paused) return;
                        const t = (performance.now() - startT) * 0.001;
                        const env = Math.max(0.15, 0.58 + 0.34 * Math.sin(t * 26.0));
                        const v = vowels[Math.floor(t * 9) % vowels.length];
                        this.simulatedVolume = env;
                        this.isSimulating = true;
                        if (onViseme) onViseme(env, { vowel: v, openness: env, emphasis: env * 0.8, beat: Math.sin(t * 14) > 0.92 });
                    }, 32);

                    audioEl.onended = () => {
                        if (this.activeAudioEl === audioEl) {
                            this.activeAudioEl = null;
                            this.isPlayingBuffer = false;
                            this.isSimulating = false;
                        }
                        if (this.visemeTimer) {
                            clearInterval(this.visemeTimer);
                            this.visemeTimer = null;
                        }
                        if (onViseme) onViseme(0, { vowel: 'sil', openness: 0, emphasis: 0 });
                        resolve(true);
                    };

                    audioEl.onerror = (e) => {
                        this.stopAudioBuffer();
                        reject(new Error('HTMLAudioElement error'));
                    };

                    await audioEl.play();
                    return;
                } catch (elErr) {
                    this.stopAudioBuffer();
                    reject(elErr);
                    return;
                }
            }

            reject(new Error('AudioContext suspended and no blobUrl available'));
        });
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
            } catch (e) {}
        }
        if (this.activeAudioEl) {
            const el = this.activeAudioEl;
            this.activeAudioEl = null;
            try {
                el.onended = null;
                el.onerror = null;
                el.pause();
                el.src = '';
            } catch (e) {}
        }
        this.isPlayingBuffer = false;
        this.isSimulating = false;
        this.prevRms = 0;
    }

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

    analyzeFormantViseme() {
        if (!this.analyser || !this.dataArray || !this.timeArray) {
            return { vowel: 'sil', openness: 0, emphasis: 0, beat: false };
        }

        this.analyser.getByteFrequencyData(this.dataArray);
        this.analyser.getByteTimeDomainData(this.timeArray);

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

        const f0Murmur = this._bandEnergy(110, 300);
        const f1Jaw = this._bandEnergy(320, 880);
        const midBack = this._bandEnergy(880, 1450);
        const f2Front = this._bandEnergy(1500, 2950);
        const sibilance = this._bandEnergy(3000, 6200);

        const openness = Math.min(1.0, Math.max(0.06, rms * 3.2 + f1Jaw * 0.42));
        const emphasis = Math.min(1.0, rms * 3.4 + f2Front * 0.3);

        const now = performance.now();
        const rmsDelta = rms - this.prevRms;
        this.prevRms = rms * 0.65 + this.prevRms * 0.35;
        let beat = false;
        if (rmsDelta > 0.055 && openness > 0.34 && (now - this.lastBeatAt > 340)) {
            beat = true;
            this.lastBeatAt = now;
        }

        let vowel = 'a';
        if (f0Murmur > 0.28 && f1Jaw < 0.16 && f2Front < 0.12) {
            vowel = 'm';
        } else if ((f2Front > f1Jaw * 0.78 && f1Jaw < 0.36) || sibilance > 0.28) {
            vowel = 'i';
        } else if (f1Jaw > 0.40 && midBack > 0.26 && f2Front < midBack * 0.92) {
            vowel = 'a';
        } else if (f1Jaw > 0.28 && f2Front >= midBack * 0.85) {
            vowel = 'e';
        } else if (midBack > 0.20 && f2Front < 0.22) {
            vowel = 'o';
        } else if (f0Murmur > 0.22 && f2Front < 0.18) {
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
