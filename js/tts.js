/**
 * Hybrid Studio Neural / Offline WAV Audio TTS + Real Acoustic FFT & Grapheme Lip-Sync Engine
 *
 * Architecture:
 * 1. Parallel Clause Audio Prefetch (`enqueueClause`):
 *    As soon as the LLM streams Clause N, immediately prefetches & decodes `/api/tts` audio in the background
 *    so Clause 2 plays seamlessly (<40ms gap) right after Clause 1 finishes!
 * 2. Studio Neural Voice (`edge-tts` Ava/Nanami) + Automatic 100% Offline Windows SAPI WAV Fallback:
 *    Both produce real Web Audio waveforms analyzed by `AudioVisualizer.analyzeFormantViseme()` for true F1/F2 lip-sync!
 * 3. Resilient Browser Web Speech Fallback:
 *    Automatically falls back to `window.speechSynthesis` + 6-viseme grapheme co-articulation if `server.py` is unreachable.
 */
export class TTSEngine {
    constructor(visualizer = null) {
        this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
        this.visualizer = visualizer;
        this.voices = [];

        const storageGet = (k, def) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null) || def;
        this.selectedVoiceURI = storageGet('miku_voice_uri', '');
        this.pitch = parseFloat(storageGet('miku_voice_pitch', '1.14'));
        this.rate = parseFloat(storageGet('miku_voice_rate', '1.06'));
        // 'auto' (Neural + Offline WAV fallback) | 'offline' (100% Local SAPI WAV) | 'browser' (Web Speech API)
        this.engineMode = storageGet('miku_tts_mode', 'auto');

        this.serverBaseUrl = null;
        this.serverAvailable = false;
        this.serverCapabilities = null;

        this.isSpeaking = false;
        this.speechQueue = [];
        this.streamSessionActive = false;
        this.sessionToken = 0;

        this.onPhonemeCallback = null;
        this.onEndCallback = null;
        this.onStartCallback = null;
        this.onErrorCallback = null;
        this.onClauseActionCallback = null;

        this.currentUtterance = null;
        this.activeText = '';
        this.activeCharIndex = 0;
        this.utteranceStartTime = 0;
        this.lipSyncTimer = null;
        this.safetyTimer = null;

        this.loadVoices();
        if (this.synth && typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => this.loadVoices();
        }

        this.probeServer();
    }

    setVisualizer(visualizer) {
        this.visualizer = visualizer;
    }

    setEngineMode(mode) {
        this.engineMode = mode || 'auto';
        if (typeof localStorage !== 'undefined') localStorage.setItem('miku_tts_mode', this.engineMode);
    }

    /**
     * Discover local `server.py` Neural/Offline WAV endpoint (works on port 8080 AND cross-origin from Apache port 80!)
     */
    async probeServer() {
        const candidates = ['', 'http://127.0.0.1:8080'];
        for (const base of candidates) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 2200);
                const res = await fetch(`${base}/api/health`, { signal: controller.signal });
                clearTimeout(timer);
                if (res.ok) {
                    const info = await res.json();
                    if (info && info.ok) {
                        this.serverBaseUrl = base;
                        this.serverAvailable = true;
                        this.serverCapabilities = info;
                        console.log(`[TTS] Neural/WAV Voice Server online at '${base || '/'}'`, info);
                        return true;
                    }
                }
            } catch (e) { }
        }
        this.serverAvailable = false;
        return false;
    }

    loadVoices() {
        if (!this.synth) return [];
        this.voices = this.synth.getVoices();
        return this.voices;
    }

    getVoices() {
        if (!this.voices.length) {
            this.loadVoices();
        }
        return this.voices;
    }

    setPitch(val) {
        this.pitch = parseFloat(val);
        if (typeof localStorage !== 'undefined') localStorage.setItem('miku_voice_pitch', this.pitch);
    }

    setRate(val) {
        this.rate = parseFloat(val);
        if (typeof localStorage !== 'undefined') localStorage.setItem('miku_voice_rate', this.rate);
    }

    setVoice(uri) {
        this.selectedVoiceURI = uri;
        if (typeof localStorage !== 'undefined') localStorage.setItem('miku_voice_uri', uri);
    }

    /**
     * Synchronously unlock Web Audio & SpeechSynthesis during user gesture (click/keydown)
     */
    primeAudio() {
        if (this.visualizer) {
            this.visualizer.ensureAudioContext();
        }
        if (!this.synth) return;
        try {
            if (this.synth.paused) {
                this.synth.resume();
            }
            if (!this.synth.speaking && !this.synth.pending && this.engineMode === 'browser') {
                const prime = new SpeechSynthesisUtterance(' ');
                prime.volume = 0.01;
                prime.rate = 2;
                this.synth.speak(prime);
            }
        } catch (e) { }
    }

    sanitizeSpokenText(text) {
        return (text || '')
            .replace(/\*[^*]+\*/g, ' ')
            .replace(/\[[^\]]+\]/g, ' ')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
            .replace(/[`#_>~|]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    detectLanguage(text) {
        if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP';
        if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR';
        if (/[\u0900-\u097f]/.test(text)) return 'hi-IN';
        if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU';
        if (/[\u0600-\u06ff]/.test(text)) return 'ar-SA';
        if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN';
        if (/[áéíóúüñ¿¡]/i.test(text)) return 'es-ES';
        if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr-FR';
        if (/[äöüß]/i.test(text)) return 'de-DE';
        return 'en-US';
    }

    findBestVoice(lang) {
        const langCode = lang.split('-')[0].toLowerCase();
        const available = this.getVoices();

        if (this.selectedVoiceURI) {
            const chosen = available.find(v => v.voiceURI === this.selectedVoiceURI);
            if (chosen && chosen.lang.toLowerCase().startsWith(langCode)) {
                return chosen;
            }
        }

        const matching = available.filter(v => v.lang.toLowerCase().startsWith(langCode));
        if (!matching.length) {
            return available.find(v => v.default) || available[0] || null;
        }

        const preferred = ['aria', 'jenny', 'ava', 'emma', 'sonia', 'nanami', 'natural', 'online', 'google', 'zira', 'ayumi', 'haruka', 'female'];
        for (const p of preferred) {
            const found = matching.find(v => v.name.toLowerCase().includes(p));
            if (found) return found;
        }

        return matching[0];
    }

    getEmotionalProsody(action, text) {
        let pitchMod = 0;
        let rateMod = 0;

        switch (action) {
            case 'cheer':
            case 'laugh':
                pitchMod = 0.06;
                rateMod = 0.05;
                break;
            case 'surprise':
                pitchMod = 0.08;
                rateMod = 0.04;
                break;
            case 'empathy':
            case 'shy':
                pitchMod = -0.04;
                rateMod = -0.05;
                break;
            case 'think':
            case 'shrug':
                pitchMod = -0.02;
                rateMod = -0.02;
                break;
            case 'wink':
            case 'pout':
                pitchMod = 0.03;
                rateMod = 0.02;
                break;
            default:
                break;
        }

        if ((text || '').trim().endsWith('?')) {
            pitchMod += 0.03;
        }

        return {
            pitch: Math.max(0.7, Math.min(1.6, this.pitch + pitchMod)),
            rate: Math.max(0.75, Math.min(1.45, this.rate + rateMod))
        };
    }

    shouldUseServerAudio() {
        return this.engineMode !== 'browser' && this.serverAvailable && !!this.visualizer;
    }

    /**
     * Prefetch & decode Neural MP3 or Offline SAPI WAV into a Web Audio AudioBuffer immediately
     */
    async _fetchAndDecodeServerAudio(text, lang, action) {
        const mode = this.engineMode === 'offline' ? 'offline' : 'auto';
        const res = await fetch(`${this.serverBaseUrl}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                lang,
                emotion: action || 'explain',
                mode
            })
        });
        if (!res.ok) {
            throw new Error(`TTS HTTP ${res.status}`);
        }
        const engineHeader = res.headers.get('X-Voice-Engine') || mode;
        const arrayBuf = await res.arrayBuffer();
        if (!arrayBuf || arrayBuf.byteLength < 64) {
            throw new Error('Empty audio buffer');
        }
        const audioBuffer = await this.visualizer.decodeAudio(arrayBuf);
        return { audioBuffer, engineUsed: engineHeader };
    }

    beginStreamSession({ onPhoneme, onStart, onEnd, onError, onClauseAction } = {}) {
        this.stop();
        this.streamSessionActive = true;
        this.sessionToken++;
        this.onPhonemeCallback = onPhoneme || null;
        this.onStartCallback = onStart || null;
        this.onEndCallback = onEnd || null;
        this.onErrorCallback = onError || null;
        this.onClauseActionCallback = onClauseAction || null;
    }

    /**
     * Enqueue a streamed clause and immediately kick off parallel audio synthesis!
     */
    enqueueClause(text, action = 'explain') {
        const clean = this.sanitizeSpokenText(text);
        if (!clean) return;

        const lang = this.detectLanguage(clean);
        const item = { text: clean, action, lang, audioPromise: null };

        if (this.shouldUseServerAudio()) {
            item.audioPromise = this._fetchAndDecodeServerAudio(clean, lang, action).catch((err) => {
                console.warn('[TTS] Server synthesis fallback to browser voice:', err.message);
                return null;
            });
        }

        this.speechQueue.push(item);
        if (!this.isSpeaking && !this.currentUtterance && !(this.visualizer && this.visualizer.isPlayingBuffer)) {
            this._playNextInQueue(this.sessionToken);
        }
    }

    endStreamSession() {
        this.streamSessionActive = false;
        const activeBuffer = this.visualizer && this.visualizer.isPlayingBuffer;
        if (!this.isSpeaking && !this.currentUtterance && !activeBuffer && this.speechQueue.length === 0) {
            this.finishSpeech();
        }
    }

    speak(text, onPhoneme, onStart, onEnd, onError = null, action = 'explain') {
        this.stop();
        const clean = this.sanitizeSpokenText(text);
        if (!clean) {
            if (onEnd) onEnd();
            return;
        }

        this.streamSessionActive = false;
        const token = ++this.sessionToken;
        this.onPhonemeCallback = onPhoneme || null;
        this.onStartCallback = onStart || null;
        this.onEndCallback = onEnd || null;
        this.onErrorCallback = onError || null;
        this.onClauseActionCallback = null;

        const lang = this.detectLanguage(clean);
        const item = { text: clean, action, lang, audioPromise: null };
        if (this.shouldUseServerAudio()) {
            item.audioPromise = this._fetchAndDecodeServerAudio(clean, lang, action).catch((err) => {
                console.warn('[TTS] Server synthesis fallback to browser voice:', err.message);
                return null;
            });
        }

        this.speechQueue.push(item);
        setTimeout(() => this._playNextInQueue(token), 15);
    }

    async _playNextInQueue(token = this.sessionToken) {
        if (token !== this.sessionToken) return;

        if (this.speechQueue.length === 0) {
            if (!this.streamSessionActive) {
                this.finishSpeech();
            } else {
                this.isSpeaking = false;
                if (this.onPhonemeCallback) {
                    this.onPhonemeCallback(0, { vowel: 'sil', openness: 0, emphasis: 0 });
                }
            }
            return;
        }

        const item = this.speechQueue.shift();
        const { text, action, lang, audioPromise } = item;

        // Path 1: Studio Neural / Offline WAV AudioBuffer with Real F1/F2 Formant FFT Lip-Sync!
        if (audioPromise) {
            this.isSpeaking = true;
            const decoded = await audioPromise;
            if (token !== this.sessionToken) return;

            if (decoded && decoded.audioBuffer) {
                const engineLabel = decoded.engineUsed === 'sapi-offline-wav'
                    ? 'Offline WAV'
                    : 'Neural Voice';

                if (this.onStartCallback) {
                    this.onStartCallback(engineLabel);
                }
                if (this.onClauseActionCallback && action) {
                    this.onClauseActionCallback(action, text);
                }

                let fellBack = false;
                await this.visualizer.playDecodedBuffer(decoded.audioBuffer, {
                    onViseme: (openness, viseme) => {
                        if (token !== this.sessionToken) return;
                        if (this.onPhonemeCallback) {
                            this.onPhonemeCallback(openness, viseme);
                        }
                    },
                    onEnded: () => {
                        if (token !== this.sessionToken || fellBack) return;
                        if (this.speechQueue.length > 0) {
                            if (this.onPhonemeCallback) {
                                this.onPhonemeCallback(0.05, { vowel: 'sil', openness: 0.05, emphasis: 0, breath: true });
                            }
                            setTimeout(() => this._playNextInQueue(token), 40);
                        } else if (this.streamSessionActive) {
                            this.isSpeaking = false;
                            if (this.onPhonemeCallback) {
                                this.onPhonemeCallback(0, { vowel: 'sil', openness: 0, emphasis: 0 });
                            }
                        } else {
                            this.finishSpeech();
                        }
                    },
                    onError: (err) => {
                        fellBack = true;
                        console.warn('[TTS] WebAudio playback blocked/failed, falling back to SpeechSynthesis:', err.message);
                        this._speakBrowserUtterance(text, action, lang, token);
                    }
                });
                return;
            }
        }

        // Path 2: Browser SpeechSynthesis + 6-Viseme Grapheme Co-Articulation Fallback
        this._speakBrowserUtterance(text, action, lang, token);
    }

    _speakBrowserUtterance(text, action, lang, token) {
        if (token !== this.sessionToken) return;
        if (!this.synth) {
            this.finishSpeech();
            return;
        }

        const voice = this.findBestVoice(lang);
        const prosody = this.getEmotionalProsody(action, text);

        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang || lang;
        } else {
            utterance.lang = lang;
        }
        utterance.pitch = prosody.pitch;
        utterance.rate = prosody.rate;

        this.activeText = text;
        this.activeCharIndex = 0;
        this.currentUtterance = utterance;

        utterance.onstart = () => {
            if (token !== this.sessionToken) return;
            const wasAlreadySpeaking = this.isSpeaking;
            this.isSpeaking = true;
            this.utteranceStartTime = performance.now();
            if (!wasAlreadySpeaking && this.onStartCallback) {
                this.onStartCallback(voice?.name || lang);
            }
            if (this.onClauseActionCallback && action) {
                this.onClauseActionCallback(action, text);
            }
            this.startLipSyncDriver();
        };

        utterance.onboundary = (event) => {
            if (typeof event.charIndex === 'number') {
                this.activeCharIndex = event.charIndex;
            }
            if (this.onPhonemeCallback && this.isSpeaking && event.name === 'word') {
                const viseme = this.extractVisemeAt(this.activeText, this.activeCharIndex, 0.85);
                viseme.beat = true;
                this.onPhonemeCallback(viseme.openness, viseme);
            }
        };

        utterance.onend = () => {
            if (token !== this.sessionToken) return;
            clearTimeout(this.safetyTimer);
            this.currentUtterance = null;
            if (this.speechQueue.length > 0) {
                if (this.onPhonemeCallback) {
                    this.onPhonemeCallback(0.06, { vowel: 'sil', openness: 0.06, emphasis: 0, breath: true });
                }
                setTimeout(() => this._playNextInQueue(token), 55);
            } else if (this.streamSessionActive) {
                this.isSpeaking = false;
                if (this.onPhonemeCallback) {
                    this.onPhonemeCallback(0, { vowel: 'sil', openness: 0, emphasis: 0 });
                }
            } else {
                this.finishSpeech();
            }
        };

        utterance.onerror = (e) => {
            if (e.error === 'interrupted' || e.error === 'canceled') return;
            console.warn("[TTS] SpeechSynthesis error:", e.error);
            clearTimeout(this.safetyTimer);
            this.currentUtterance = null;
            if (this.speechQueue.length > 0) {
                this._playNextInQueue(token);
            } else {
                this.finishSpeech();
                if (this.onErrorCallback) this.onErrorCallback(e.error);
            }
        };

        try {
            if (this.synth.paused) this.synth.resume();
            this.synth.speak(utterance);

            const maxExpectedMs = Math.max(4500, text.length * 130);
            clearTimeout(this.safetyTimer);
            this.safetyTimer = setTimeout(() => {
                if (this.currentUtterance === utterance && token === this.sessionToken) {
                    this.currentUtterance = null;
                    this._playNextInQueue(token);
                }
            }, maxExpectedMs);
        } catch (err) {
            this.finishSpeech();
            if (this.onErrorCallback) this.onErrorCallback(err.message);
        }
    }

    extractVisemeAt(text, index, baseEnergy = 0.7) {
        if (!text || index >= text.length) {
            return { vowel: 'a', openness: baseEnergy * 0.5, emphasis: baseEnergy * 0.4 };
        }
        const slice = text.slice(index, index + 3).toLowerCase();
        const ch = slice[0] || '';
        const ch2 = slice.slice(0, 2);

        if (/[,.;:!?—–\-\s]/.test(ch)) {
            return { vowel: 'sil', openness: 0.04, emphasis: 0.05 };
        }
        if (ch === 'm' || ch === 'b' || ch === 'p' || ch === 'ん' || ch === 'ま' || ch === 'ば' || ch === 'ぱ') {
            return { vowel: 'm', openness: 0.0, emphasis: baseEnergy * 0.5 };
        }
        if (ch2 === 'oo' || ch2 === 'ou' || ch2 === 'sh' || ch2 === 'ch' || ch === 'u' || ch === 'w' || /[うくすつぬふむゆる]/.test(ch)) {
            return { vowel: 'u', openness: baseEnergy * 0.55, emphasis: baseEnergy * 0.45 };
        }
        if (ch2 === 'oa' || ch2 === 'ow' || ch2 === 'au' || ch === 'o' || /[おこそとのほもよろ]/.test(ch)) {
            return { vowel: 'o', openness: baseEnergy * 0.78, emphasis: baseEnergy * 0.65 };
        }
        if (ch2 === 'ee' || ch2 === 'ea' || ch === 'i' || ch === 'y' || ch === 's' || ch === 'z' || /[いきしちにひみり]/.test(ch)) {
            return { vowel: 'i', openness: baseEnergy * 0.52, emphasis: baseEnergy * 0.5 };
        }
        if (ch2 === 'ay' || ch2 === 'ai' || ch === 'e' || /[えけせてねへめれ]/.test(ch)) {
            return { vowel: 'e', openness: baseEnergy * 0.66, emphasis: baseEnergy * 0.55 };
        }
        if (ch === 'a' || /[あかさたなはまやらわ]/.test(ch)) {
            return { vowel: 'a', openness: Math.min(1.0, baseEnergy * 0.95), emphasis: baseEnergy * 0.8 };
        }
        return { vowel: 'e', openness: baseEnergy * 0.42, emphasis: baseEnergy * 0.35 };
    }

    startLipSyncDriver() {
        if (this.lipSyncTimer) clearInterval(this.lipSyncTimer);

        let localOffset = 0;
        let lastBoundaryIdx = this.activeCharIndex;

        this.lipSyncTimer = setInterval(() => {
            if (!this.isSpeaking) {
                clearInterval(this.lipSyncTimer);
                this.lipSyncTimer = null;
                if (this.onPhonemeCallback) {
                    this.onPhonemeCallback(0, { vowel: 'sil', openness: 0, emphasis: 0 });
                }
                return;
            }

            if (this.activeCharIndex !== lastBoundaryIdx) {
                lastBoundaryIdx = this.activeCharIndex;
                localOffset = 0;
            } else {
                localOffset += 0.46;
            }

            const charPos = Math.min(
                Math.max(0, this.activeText.length - 1),
                this.activeCharIndex + Math.floor(localOffset)
            );

            const t = (performance.now() - this.utteranceStartTime) * 0.001;
            const envelope = 0.62 + 0.32 * Math.sin(t * 28.0) + 0.08 * Math.cos(t * 13.0);
            const viseme = this.extractVisemeAt(this.activeText, charPos, Math.max(0.25, envelope));

            if (this.onPhonemeCallback) {
                this.onPhonemeCallback(viseme.openness, viseme);
            }
        }, 33);
    }

    finishSpeech() {
        this.isSpeaking = false;
        this.streamSessionActive = false;
        this.speechQueue = [];
        clearTimeout(this.safetyTimer);
        if (this.lipSyncTimer) {
            clearInterval(this.lipSyncTimer);
            this.lipSyncTimer = null;
        }
        if (this.onPhonemeCallback) {
            this.onPhonemeCallback(0, { vowel: 'sil', openness: 0, emphasis: 0 });
        }
        const endCb = this.onEndCallback;
        this.onEndCallback = null;
        this.currentUtterance = null;
        if (endCb) {
            endCb();
        }
    }

    stop() {
        this.sessionToken++;
        clearTimeout(this.safetyTimer);
        this.isSpeaking = false;
        this.streamSessionActive = false;
        this.speechQueue = [];
        if (this.lipSyncTimer) {
            clearInterval(this.lipSyncTimer);
            this.lipSyncTimer = null;
        }
        if (this.visualizer) {
            this.visualizer.stopAudioBuffer();
        }
        if (this.onPhonemeCallback) {
            this.onPhonemeCallback(0, { vowel: 'sil', openness: 0, emphasis: 0 });
        }
        this.onEndCallback = null;
        this.onErrorCallback = null;
        this.onClauseActionCallback = null;
        this.currentUtterance = null;
        if (this.synth && (this.synth.speaking || this.synth.pending)) {
            try {
                this.synth.cancel();
            } catch (e) { }
        }
    }
}
