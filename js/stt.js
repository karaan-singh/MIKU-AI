/**
 * Multilingual Speech-to-Text (STT) Engine using Web Speech API
 * Supports hands-free auto silence detection & push-to-talk Spacebar/Mic
 */
export class STTEngine {
    constructor() {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.supported = !!SpeechRec;
        this.recognition = SpeechRec ? new SpeechRec() : null;
        this.isListening = false;
        this.language = localStorage.getItem('miku_stt_lang') || 'en-US';

        this.onResultCallback = null;
        this.onInterimCallback = null;
        this.onStartCallback = null;
        this.onEndCallback = null;
        this.onErrorCallback = null;

        this.silenceTimer = null;
        this.finalTranscript = '';
        this.latestInterim = '';

        if (this.recognition) {
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.maxAlternatives = 1;
            this.recognition.lang = this.language;

            this.setupEvents();
        }
    }

    setLanguage(langCode) {
        this.language = langCode;
        localStorage.setItem('miku_stt_lang', langCode);
        if (this.recognition) {
            this.recognition.lang = langCode;
        }
    }

    setupEvents() {
        this.recognition.onstart = () => {
            this.isListening = true;
            if (this.onStartCallback) this.onStartCallback();
        };

        this.recognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const part = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    this.finalTranscript += ' ' + part;
                } else {
                    interim += part;
                }
            }

            this.latestInterim = interim;
            const current = (this.finalTranscript + ' ' + interim).trim();
            if (this.onInterimCallback) {
                this.onInterimCallback(current);
            }

            // Always detect silence (1.4s of pause after speaking) to trigger auto-submission
            if (current.length > 0) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = setTimeout(() => {
                    this.triggerFinalResult();
                }, 1400);
            }
        };

        this.recognition.onerror = (e) => {
            console.warn("[STT] Recognition Error:", e.error);
            clearTimeout(this.silenceTimer);
            if (this.onErrorCallback) this.onErrorCallback(e.error);
        };

        this.recognition.onend = () => {
            this.isListening = false;
            clearTimeout(this.silenceTimer);
            if (this.onEndCallback) this.onEndCallback();
        };
    }

    start(onResult, onInterim, onStart, onEnd, onError) {
        if (!this.supported) {
            alert("Speech Recognition is not supported by this browser. Please use Google Chrome, Microsoft Edge, or type in the chat input.");
            return;
        }

        this.onResultCallback = onResult;
        this.onInterimCallback = onInterim;
        this.onStartCallback = onStart;
        this.onEndCallback = onEnd;
        this.onErrorCallback = onError;

        this.finalTranscript = '';
        this.latestInterim = '';

        try {
            this.recognition.start();
        } catch (e) {
            console.warn("[STT] Already active or restarting:", e);
        }
    }

    stop() {
        clearTimeout(this.silenceTimer);
        if (this.recognition && this.isListening) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }
        this.isListening = false;
    }

    /**
     * Submits all collected speech (both final and interim)
     */
    triggerFinalResult() {
        clearTimeout(this.silenceTimer);
        const text = (this.finalTranscript + ' ' + (this.latestInterim || '')).trim();
        this.finalTranscript = '';
        this.latestInterim = '';
        this.stop();

        if (text && this.onResultCallback) {
            this.onResultCallback(text);
        }
    }
}
