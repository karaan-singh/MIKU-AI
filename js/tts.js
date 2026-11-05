/**
 * Multilingual Text-to-Speech Engine with Anime Voice Pitch & Lip-Sync Driver
 * Resilient against Chrome speech paused state, unlock priming, and cancel race conditions
 */
export class TTSEngine {
    constructor(audioContext = null) {
        this.synth = window.speechSynthesis;
        this.audioCtx = audioContext;
        this.voices = [];
        this.selectedVoiceURI = localStorage.getItem('miku_voice_uri') || '';
        this.pitch = parseFloat(localStorage.getItem('miku_voice_pitch') || '1.18'); // Cheerful anime pitch
        this.rate = parseFloat(localStorage.getItem('miku_voice_rate') || '1.05');  // Snappy pace
        this.isSpeaking = false;
        this.onPhonemeCallback = null;
        this.onEndCallback = null;
        this.onStartCallback = null;
        this.onErrorCallback = null;
        this.currentUtterance = null;
        this.lipSyncTimer = null;
        this.safetyTimer = null;

        this.loadVoices();
        if (this.synth) {
            if (speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = () => this.loadVoices();
            }
        }
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
        localStorage.setItem('miku_voice_pitch', this.pitch);
    }

    setRate(val) {
        this.rate = parseFloat(val);
        localStorage.setItem('miku_voice_rate', this.rate);
    }

    setVoice(uri) {
        this.selectedVoiceURI = uri;
        localStorage.setItem('miku_voice_uri', uri);
    }

    /**
     * Synchronously prime & unlock SpeechSynthesis during a user interaction (click/keydown)
     * This prevents Chrome's transient user activation expiry during async Ollama generation
     */
    primeAudio() {
        if (!this.synth) return;
        try {
            if (this.synth.paused) {
                this.synth.resume();
            }
            // Prime a tiny utterance to register speech audio activation with the browser
            const prime = new SpeechSynthesisUtterance(' ');
            prime.volume = 0.01;
            prime.rate = 2;
            this.synth.speak(prime);
        } catch (e) {
            // Silently ignore priming errors
        }
    }

    /**
     * Auto-detect text language using Unicode ranges
     */
    detectLanguage(text) {
        if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP'; // Japanese
        if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR'; // Korean
        if (/[\u0900-\u097f]/.test(text)) return 'hi-IN'; // Hindi
        if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU'; // Russian
        if (/[\u0600-\u06ff]/.test(text)) return 'ar-SA'; // Arabic
        if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN'; // Chinese
        if (/[áéíóúüñ¿¡]/i.test(text))     return 'es-ES'; // Spanish
        if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr-FR'; // French
        if (/[äöüß]/i.test(text))          return 'de-DE'; // German
        return 'en-US'; // Default English
    }

    /**
     * Pick best voice matching language and prefer female / anime-suited voices
     */
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

        // Preferred voice keywords for high-quality female/anime tone
        const preferred = ['nanami', 'ayumi', 'haruka', 'sayaka', 'zira', 'female', 'natural', 'jenny', 'aria', 'google'];
        for (const p of preferred) {
            const found = matching.find(v => v.name.toLowerCase().includes(p));
            if (found) return found;
        }

        return matching[0];
    }

    /**
     * Speak text and trigger real-time lip sync pulses
     */
    speak(text, onPhoneme, onStart, onEnd, onError = null) {
        if (!this.synth) {
            console.warn("[TTS] SpeechSynthesis not supported.");
            if (onEnd) onEnd();
            return;
        }

        // Cancel any active speech cleanly
        this.stop();

        const lang = this.detectLanguage(text);
        const voice = this.findBestVoice(lang);
        const utterance = new SpeechSynthesisUtterance(text);

        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang || lang;
        } else {
            utterance.lang = lang;
        }

        utterance.pitch = this.pitch;
        utterance.rate = this.rate;

        this.onPhonemeCallback = onPhoneme;
        this.onStartCallback = onStart;
        this.onEndCallback = onEnd;
        this.onErrorCallback = onError;

        utterance.onstart = () => {
            this.isSpeaking = true;
            if (this.onStartCallback) this.onStartCallback(voice?.name || lang);
            this.startLipSyncDriver();
        };

        utterance.onend = () => {
            this.finishSpeech();
        };

        utterance.onerror = (e) => {
            // Ignore intentional cancellations or interruptions from previous utterances
            if (e.error === 'interrupted' || e.error === 'canceled') {
                return;
            }
            console.warn("[TTS] SpeechSynthesis error:", e.error);
            this.finishSpeech();
            if (this.onErrorCallback) this.onErrorCallback(e.error);
        };

        utterance.onboundary = (event) => {
            if (this.onPhonemeCallback && this.isSpeaking) {
                const burst = 0.7 + Math.random() * 0.3;
                this.onPhonemeCallback(burst);
            }
        };

        this.currentUtterance = utterance;

        // In Chrome, ensure speech engine is unpaused
        if (this.synth.paused) {
            this.synth.resume();
        }

        // Small delay avoids Chrome cancel/speak collision
        setTimeout(() => {
            try {
                if (this.synth.paused) this.synth.resume();
                this.synth.speak(utterance);

                // Watchdog safety timer: force finish if browser speech hangs
                const maxExpectedMs = Math.max(5000, text.length * 150);
                clearTimeout(this.safetyTimer);
                this.safetyTimer = setTimeout(() => {
                    if (this.isSpeaking) {
                        console.warn("[TTS] Watchdog timer fired: finalizing speech.");
                        this.finishSpeech();
                    }
                }, maxExpectedMs);
            } catch (err) {
                console.error("[TTS] Speak failed:", err);
                this.finishSpeech();
                if (this.onErrorCallback) this.onErrorCallback(err.message);
            }
        }, 40);
    }

    startLipSyncDriver() {
        if (this.lipSyncTimer) clearInterval(this.lipSyncTimer);

        let phase = 0;
        this.lipSyncTimer = setInterval(() => {
            if (!this.isSpeaking) {
                clearInterval(this.lipSyncTimer);
                if (this.onPhonemeCallback) this.onPhonemeCallback(0);
                return;
            }

            phase += 0.25;
            const sineWave = Math.sin(phase * 4);
            const noise = Math.random() * 0.35;
            let openness = (sineWave > 0 ? sineWave * 0.8 : 0.1) + noise;

            if (Math.random() < 0.15) openness = 0.05;

            openness = Math.min(1.0, Math.max(0.0, openness));
            if (this.onPhonemeCallback) {
                this.onPhonemeCallback(openness);
            }
        }, 50);
    }

    finishSpeech() {
        this.isSpeaking = false;
        clearTimeout(this.safetyTimer);
        if (this.lipSyncTimer) {
            clearInterval(this.lipSyncTimer);
            this.lipSyncTimer = null;
        }
        if (this.onPhonemeCallback) {
            this.onPhonemeCallback(0);
        }
        if (this.onEndCallback) {
            this.onEndCallback();
        }
        this.currentUtterance = null;
    }

    stop() {
        clearTimeout(this.safetyTimer);
        this.isSpeaking = false;
        if (this.lipSyncTimer) {
            clearInterval(this.lipSyncTimer);
            this.lipSyncTimer = null;
        }
        if (this.onPhonemeCallback) {
            this.onPhonemeCallback(0);
        }
        this.currentUtterance = null;
        if (this.synth && (this.synth.speaking || this.synth.pending)) {
            try {
                this.synth.cancel();
            } catch (e) {}
        }
    }
}
