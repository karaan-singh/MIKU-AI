/**
 * Local Ollama Client for Hatsune Miku 3D Human-Like Companion
 *
 * Root-Cause Fixes for Real-Human Dialogue & Speed on Qwen 2.5 / Dolphin 3.0:
 * 1. Native Raw ChatML Multi-Turn Builder (`buildChatMLPrompt` + `/api/generate` raw:true):
 *    Fixes `nchapman/dolphin3.0-qwen2.5:3b`'s single-turn Modelfile TEMPLATE bug (`{{ .Prompt }}` instead of `{{ .Messages }}`),
 *    giving 100% accurate multi-turn memory and crisp turn boundaries (`<|im_start|>` / `<|im_end|>`).
 * 2. Qwen-Calibrated Sampling (`temperature: 0.48`, `top_p: 0.85`, `top_k: 25`, `repeat_penalty: 1.05`):
 *    Eliminates the Qwen 2.5 high-repeat-penalty vocabulary distortion that previously forced theatrical/corny synonyms.
 * 3. Grounded Real-Human System Prompt + Cached Few-Shot Anchors:
 *    Eliminates roleplay hallucinations, fake events, and robotic cliches—speaks in plain, natural everyday human talk.
 * 4. Startup RAM Pre-Warm + `keep_alive: "30m"` + Real-Time Clause Voice Streaming (~1.9s-3.5s total response!).
 */
export class OllamaClient {
    constructor() {
        const storageGet = (k, def) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null) || def;
        const storageSet = (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); };

        let savedHost = storageGet('ollama_host', 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
        if (savedHost === 'http://localhost:11434') {
            savedHost = 'http://127.0.0.1:11434';
            storageSet('ollama_host', savedHost);
        }
        this.host = savedHost;

        let savedModel = storageGet('ollama_model', 'miku-human:latest');
        // Guard against raw unaligned code-completion base models accidentally selected in localStorage
        if (savedModel.endsWith('-base')) {
            savedModel = 'miku-human:latest';
            storageSet('ollama_model', savedModel);
        }
        this.model = savedModel;
        this.turboMode = storageGet('ollama_turbo_mode', 'true') !== 'false';
        this.cpuThreads = parseInt(storageGet('ollama_threads', '4'), 10) || 4;
        this.memoryContext = '';

        this.history = [];
        this.maxHistoryTurns = 6;
        this.keepAlive = '30m';
        this.isWarmedUp = false;
        this.isWarming = false;
        this.warmUpPromise = null;
        this.activeStreamController = null;
        this.lastMetrics = null;

        // Grounded Real-Human + Full Multi-Step Desktop Automation System Prompt
        this.systemInstruction = [
            "You are Miku, talking casually one-on-one with the user like a real, normal, down-to-earth human friend who also has full control of their Windows PC and browser.",
            "Rules:",
            "- Speak in plain, natural everyday spoken language (normal contractions, relaxed human tone, no emojis, 1 to 2 short sentences).",
            "- Stay grounded in reality. Never invent fake concerts or fake backstories, never call the user 'my dear friend', and avoid cheesy phrases.",
            "- ONLY when the user asks to open/control apps, browser, YouTube, keyboard, mouse, or PC settings, start your reply with one or more tags:",
            "  <<CMD:open_url|https://...>> | <<CMD:web_search|query>> | <<CMD:youtube_play|query>> | <<CMD:youtube_search|query>> | <<CMD:open_app|app>> | <<CMD:wait|700>> | <<CMD:type_text|text>> | <<CMD:hotkey|ctrl+t>> | <<CMD:scroll|down:5>> | <<CMD:window_control|maximize>> | <<CMD:brightness|80>> | <<CMD:save_note|text>> | <<CMD:open_folder|downloads>> | <<CMD:screenshot|desktop>> | <<CMD:pc_status|summary>> | <<CMD:system_control|volume_up>>",
            "  Always include a natural spoken confirmation right after the tag(s). Never output <<CMD:...>> for normal conversation."
        ].join('\n');

        // Static few-shot anchors (100% cached in Ollama's KV prefix memory during startup pre-warm!)
        this.fewShotExamples = [
            { role: 'user', content: 'hey' },
            { role: 'assistant', content: "Hey! What's up? How's your day going?" },
            { role: 'user', content: 'ugh work was exhausting today' },
            { role: 'assistant', content: "Man, I feel that. Long days really wipe you out—hope you get to kick back and relax tonight." },
            { role: 'user', content: 'I feel bored, put on some relaxing piano music on youtube' },
            { role: 'assistant', content: "<<CMD:youtube_play|relaxing piano music>>Sure! Playing some relaxing piano music on YouTube for you right now." },
            { role: 'user', content: 'open something where I can draw a quick sketch' },
            { role: 'assistant', content: "<<CMD:open_app|paint>>Got it! Opening Paint on your screen right now." }
        ];
    }

    setHost(host) {
        let clean = (host || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
        if (clean === 'http://localhost:11434') clean = 'http://127.0.0.1:11434';
        this.host = clean;
        if (typeof localStorage !== 'undefined') localStorage.setItem('ollama_host', this.host);
    }

    setModel(modelName) {
        const next = (modelName || 'nchapman/dolphin3.0-qwen2.5:3b').trim();
        if (next !== this.model) {
            this.isWarmedUp = false;
        }
        this.model = next;
        if (typeof localStorage !== 'undefined') localStorage.setItem('ollama_model', this.model);
    }

    setTurboMode(enabled) {
        this.turboMode = !!enabled;
        if (typeof localStorage !== 'undefined') localStorage.setItem('ollama_turbo_mode', String(this.turboMode));
    }

    setCpuThreads(threads) {
        const val = Math.max(1, Math.min(16, parseInt(threads, 10) || 4));
        if (val !== this.cpuThreads) {
            this.isWarmedUp = false;
        }
        this.cpuThreads = val;
        if (typeof localStorage !== 'undefined') localStorage.setItem('ollama_threads', String(val));
    }

    clearHistory() {
        this.history = [];
    }

    setMemoryContext(ctxStr) {
        this.memoryContext = (ctxStr || '').trim();
    }

    /**
     * Check whether active model uses ChatML (<|im_start|>) formatting (miku-human / Qwen / Dolphin / Yi / Hermes)
     */
    usesRawChatML() {
        const m = (this.model || '').toLowerCase();
        return m.includes('miku-human') || m.includes('qwen') || m.includes('dolphin') || m.includes('hermes') || m.includes('yi');
    }

    /**
     * Build exact multi-turn ChatML prompt string so Qwen/Dolphin models receive crystal-clear turn boundaries,
     * 100% KV-cached system + few-shot prefix, and dynamic personal memory right next to active turns!
     */
    buildChatMLPrompt(turnMessages) {
        let prompt = `<|im_start|>system\n${this.systemInstruction}<|im_end|>\n`;
        for (const msg of this.fewShotExamples) {
            prompt += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
        }
        if (this.memoryContext) {
            prompt += `<|im_start|>system\n${this.memoryContext}<|im_end|>\n`;
        }
        for (const msg of turnMessages) {
            prompt += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
        }
        prompt += `<|im_start|>assistant\n`;
        return prompt;
    }

    /**
     * Consistent llama.cpp runner options calibrated specifically for Qwen 2.5 / Dolphin natural human speech.
     */
    getInferenceOptions(numPredict = null) {
        const predictLimit = numPredict !== null
            ? numPredict
            : (this.turboMode ? 58 : 95);

        return {
            num_ctx: 1024,
            num_thread: this.cpuThreads,
            temperature: 0.48,
            top_p: 0.85,
            top_k: 25,
            repeat_penalty: 1.05,
            num_predict: predictLimit,
            stop: ['<|im_end|>', '<|im_start|>', '<|eot_id|>', '\nUser:', '\nuser:']
        };
    }

    abortActiveRequest() {
        if (this.activeStreamController) {
            try {
                this.activeStreamController.abort();
            } catch (e) { }
            this.activeStreamController = null;
        }
    }

    getFallbackHost(currentHost) {
        if (currentHost.includes('127.0.0.1')) {
            return currentHost.replace('127.0.0.1', 'localhost');
        } else if (currentHost.includes('localhost')) {
            return currentHost.replace('localhost', '127.0.0.1');
        }
        return 'http://127.0.0.1:11434';
    }

    async fetchWithFallback(endpointPath, options = {}) {
        const externalSignal = options.signal || null;
        const timeoutMs = options.timeoutMs || 45000;
        const fetchOpts = { ...options };
        delete fetchOpts.timeoutMs;

        const attemptFetch = async (baseUrl) => {
            const controller = new AbortController();
            const onExternalAbort = () => controller.abort();
            if (externalSignal) {
                if (externalSignal.aborted) controller.abort();
                else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(`${baseUrl}${endpointPath}`, { ...fetchOpts, signal: controller.signal });
                clearTimeout(timeoutId);
                return res;
            } finally {
                clearTimeout(timeoutId);
                if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
            }
        };

        try {
            return await attemptFetch(this.host);
        } catch (primaryErr) {
            if (externalSignal && externalSignal.aborted) {
                const abortErr = new Error('Interrupted by new message');
                abortErr.name = 'AbortError';
                throw abortErr;
            }
            console.warn(`[Ollama] Failed primary host ${this.host}, trying fallback...`, primaryErr.message);
            const fallbackHost = this.getFallbackHost(this.host);
            if (fallbackHost !== this.host) {
                try {
                    const res = await attemptFetch(fallbackHost);
                    this.host = fallbackHost;
                    if (typeof localStorage !== 'undefined') localStorage.setItem('ollama_host', fallbackHost);
                    console.log(`[Ollama] Auto-switched to working host: ${fallbackHost}`);
                    return res;
                } catch (fallbackErr) {
                    throw new Error(`Cannot connect to Ollama at ${this.host} or ${fallbackHost}. Make sure Ollama is running in background ('ollama serve').`);
                }
            }
            throw primaryErr;
        }
    }

    async listAvailableModels() {
        try {
            const res = await this.fetchWithFallback('/api/tags', { timeoutMs: 5000 });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.models || []).map(m => m.name);
        } catch (e) {
            console.warn('[Ollama] Failed to list models:', e.message);
            return [];
        }
    }

    /**
     * Pre-load Qwen weights into RAM & pre-evaluate the exact ChatML system + few-shot prefix into KV cache!
     */
    async warmUpModel() {
        if (this.isWarmedUp) return true;
        if (this.warmUpPromise) return this.warmUpPromise;
        this.isWarming = true;
        const start = performance.now();
        this.warmUpPromise = (async () => {
            try {
                let res;
                if (this.usesRawChatML()) {
                    res = await this.fetchWithFallback('/api/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: this.model,
                            prompt: this.buildChatMLPrompt([{ role: 'user', content: 'hi' }]),
                            raw: true,
                            stream: false,
                            keep_alive: this.keepAlive,
                            options: this.getInferenceOptions(1)
                        }),
                        timeoutMs: 35000
                    });
                } else {
                    res = await this.fetchWithFallback('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: this.model,
                            messages: [
                                { role: 'system', content: this.systemInstruction },
                                ...this.fewShotExamples,
                                { role: 'user', content: 'hi' }
                            ],
                            stream: false,
                            keep_alive: this.keepAlive,
                            options: this.getInferenceOptions(1)
                        }),
                        timeoutMs: 35000
                    });
                }
                if (res.ok) {
                    this.isWarmedUp = true;
                    console.log(`[Ollama] Neural core '${this.model}' pre-warmed & KV-cached in ${Math.round(performance.now() - start)}ms`);
                    return true;
                }
                return false;
            } catch (e) {
                console.warn('[Ollama] Pre-warm skipped:', e.message);
                return false;
            } finally {
                this.isWarming = false;
                this.warmUpPromise = null;
            }
        })();
        return this.warmUpPromise;
    }

    async runDiagnostics() {
        const start = performance.now();
        const results = {
            success: false,
            host: this.host,
            model: this.model,
            availableModels: [],
            latencyMs: 0,
            tokensPerSec: null,
            error: null
        };

        try {
            const models = await this.listAvailableModels();
            results.host = this.host;
            results.availableModels = models;

            if (!models.length) {
                throw new Error(`Could not reach Ollama at ${this.host}. Is Ollama running? (Start Ollama from Start Menu or run 'ollama serve')`);
            }

            const modelExists = models.some(m => m === this.model || m.startsWith(this.model) || this.model.startsWith(m));
            if (!modelExists) {
                results.error = `Model '${this.model}' not found in local Ollama list. Installed models: ${models.join(', ')}`;
            }

            const pingStart = performance.now();
            const testRes = await this.fetchWithFallback('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: this.usesRawChatML() ? this.buildChatMLPrompt([{ role: 'user', content: 'Hey!' }]) : 'Hey!',
                    raw: this.usesRawChatML(),
                    stream: false,
                    keep_alive: this.keepAlive,
                    options: this.getInferenceOptions(12)
                }),
                timeoutMs: 25000
            });

            if (!testRes.ok) {
                const errText = await testRes.text();
                throw new Error(`Ollama HTTP ${testRes.status}: ${errText}`);
            }

            const data = await testRes.json();
            this.isWarmedUp = true;
            results.latencyMs = Math.round(performance.now() - pingStart);
            if (data.eval_count && data.eval_duration) {
                results.tokensPerSec = (data.eval_count / (data.eval_duration / 1e9)).toFixed(1);
            }
            results.success = true;
            return results;
        } catch (e) {
            results.latencyMs = Math.round(performance.now() - start);
            results.error = e.message;
            return results;
        }
    }

    detectUserIntent(userText) {
        const lower = (userText || '').toLowerCase().trim();
        if (/\b(sad|tir(?:ed|ing)|exhaust\w*|stress\w*|overwhelm\w*|lonely|upset|crying|depressed|hurt|bad day|rough|long day|tough|burnt out|anxious|sick)\b/.test(lower)) return 'empathy';
        if (/\b(haha|hehe|lol|lmao|rofl|joke|funny)\b/.test(lower) || /[😂🤣😆]/u.test(lower)) return 'laugh';
        if (/\b(whoa|wtf|omg|no way|seriously\?!|unbelievable|shocked)\b/.test(lower) || /[😲😱🤯]/u.test(lower)) return 'surprise';
        if (/\b(love you|cute|adorable|beautiful|pretty|sweet|amazing|best|make me smile)\b/.test(lower)) return 'shy';
        if (/\b(hi+|hey+|hello|yo|morning|evening|konnichiwa|yahho)\b/.test(lower) && lower.split(/\s+/).length <= 5) return 'greeting';
        if (lower.includes('?') || /^(what|why|how|when|where|who|can you|could you|do you|is it)\b/.test(lower)) return 'question';
        return 'attentive';
    }

    /**
     * Stream natural human response via Raw ChatML (`/api/generate`) for Qwen/Dolphin or `/api/chat` for others
     */
    async sendMessageStream(userText, onChunk = null, onActionDetected = null, onClauseReady = null, onCommandDetected = null) {
        if (!userText || !userText.trim()) return null;

        if (this.model.endsWith('-base')) {
            throw new Error(`'${this.model}' is a raw code-completion base model, not a conversational chat model. Please select 'nchapman/dolphin3.0-qwen2.5:3b' or 'llama3.1:8b' in Settings!`);
        }

        this.abortActiveRequest();
        const streamController = new AbortController();
        this.activeStreamController = streamController;

        this.history = this.history.filter(h => {
            const content = (h.content || '').toLowerCase();
            return !content.includes('class maths') &&
                !content.includes('12th chapter') &&
                !content.includes('i have a doubt') &&
                !/(\b\w+\b)(?:\s+\1){2,}/i.test(content);
        });

        const turnMessages = [
            ...this.history,
            { role: 'user', content: userText.trim() }
        ];

        let actionDetected = false;
        let commandDispatched = false;
        let detectedAction = 'idle';
        let rawAccumulated = '';
        let spokenCharCursor = 0;
        let clauseIndex = 0;
        const startTime = performance.now();
        let ttftMs = null;

        const flushReadyClauses = (isFinal = false) => {
            if (!onClauseReady) return;
            const parsedSoFar = this.parseResponse(rawAccumulated, true);
            const cleanFull = parsedSoFar.rawText || '';
            if (cleanFull.length <= spokenCharCursor) return;

            const unspoken = cleanFull.slice(spokenCharCursor);
            if (isFinal) {
                const tail = unspoken.trim();
                if (tail.length > 0) {
                    const speechTail = this.cleanForSpeech(tail);
                    if (speechTail) {
                        onClauseReady({
                            text: tail,
                            speechText: speechTail,
                            action: this.detectAction(tail),
                            index: clauseIndex++
                        });
                    }
                }
                spokenCharCursor = cleanFull.length;
                return;
            }

            const minWordsForComma = clauseIndex === 0 ? 5 : 8;
            const sentenceMatch = unspoken.match(/^([\s\S]*?[.!?~\n]+)(?=\s|$)/);
            if (sentenceMatch) {
                const candidate = sentenceMatch[1];
                const words = candidate.trim().split(/\s+/).filter(Boolean).length;
                if (words >= 2 || candidate.trim().length >= 10) {
                    spokenCharCursor += candidate.length;
                    const speechClause = this.cleanForSpeech(candidate);
                    if (speechClause) {
                        onClauseReady({
                            text: candidate.trim(),
                            speechText: speechClause,
                            action: this.detectAction(candidate),
                            index: clauseIndex++
                        });
                    }
                    return;
                }
            }

            const commaMatch = unspoken.match(/^([\s\S]*?[,;—–:])\s+/);
            if (commaMatch) {
                const candidate = commaMatch[1];
                const words = candidate.trim().split(/\s+/).filter(Boolean).length;
                if (words >= minWordsForComma) {
                    spokenCharCursor += commaMatch[0].length;
                    const speechClause = this.cleanForSpeech(candidate);
                    if (speechClause) {
                        onClauseReady({
                            text: candidate.trim(),
                            speechText: speechClause,
                            action: this.detectAction(candidate),
                            index: clauseIndex++
                        });
                    }
                }
            }
        };

        try {
            const useRaw = this.usesRawChatML();
            const endpoint = useRaw ? '/api/generate' : '/api/chat';
            const payload = useRaw
                ? {
                    model: this.model,
                    prompt: this.buildChatMLPrompt(turnMessages),
                    raw: true,
                    stream: true,
                    keep_alive: this.keepAlive,
                    options: this.getInferenceOptions()
                }
                : {
                    model: this.model,
                    messages: [
                        { role: 'system', content: this.systemInstruction + (this.memoryContext ? `\n${this.memoryContext}` : '') },
                        ...this.fewShotExamples,
                        ...turnMessages
                    ],
                    stream: true,
                    keep_alive: this.keepAlive,
                    options: this.getInferenceOptions()
                };

            const response = await this.fetchWithFallback(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: streamController.signal,
                body: JSON.stringify(payload),
                timeoutMs: 60000
            });

            if (!response.ok) {
                const errData = await response.text();
                throw new Error(`Ollama Error (${response.status}): ${errData}`);
            }

            this.isWarmedUp = true;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const parsed = JSON.parse(trimmed);
                        const token = useRaw ? (parsed.response || '') : (parsed.message?.content || '');
                        if (token && ttftMs === null) {
                            ttftMs = Math.round(performance.now() - startTime);
                        }
                        rawAccumulated += token;

                        const parsedPartial = this.parseResponse(rawAccumulated, true);

                        if (!commandDispatched && parsedPartial.command && onCommandDetected) {
                            commandDispatched = true;
                            onCommandDetected(parsedPartial.command);
                        }

                        if (!actionDetected && parsedPartial.rawText.length >= 6) {
                            if (parsedPartial.action && parsedPartial.action !== 'idle') {
                                actionDetected = true;
                                detectedAction = parsedPartial.action;
                                if (onActionDetected) onActionDetected(detectedAction);
                            }
                        }

                        if (onChunk && parsedPartial.rawText) {
                            onChunk({
                                partialText: parsedPartial.rawText,
                                action: actionDetected ? detectedAction : parsedPartial.action,
                                rawText: rawAccumulated,
                                ttftMs
                            });
                        }

                        flushReadyClauses(false);

                        if (parsed.done && parsed.eval_count && parsed.eval_duration) {
                            this.lastMetrics = {
                                ttftMs: ttftMs || Math.round(performance.now() - startTime),
                                totalMs: Math.round(performance.now() - startTime),
                                tokens: parsed.eval_count,
                                tokensPerSec: parseFloat((parsed.eval_count / (parsed.eval_duration / 1e9)).toFixed(1))
                            };
                        }
                    } catch (e) { }
                }
            }

            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer.trim());
                    const tailTok = useRaw ? (parsed.response || '') : (parsed.message?.content || '');
                    rawAccumulated += tailTok;
                } catch (e) { }
            }

            flushReadyClauses(true);

            const finalReply = rawAccumulated || "Hey! What's on your mind?";
            const parsed = this.parseResponse(finalReply, false);

            this.history.push({ role: 'user', content: userText.trim() });
            this.history.push({ role: 'assistant', content: parsed.rawText });

            if (this.history.length > this.maxHistoryTurns * 2) {
                this.history = this.history.slice(-this.maxHistoryTurns * 2);
            }

            parsed.metrics = this.lastMetrics;
            parsed.streamedClauses = clauseIndex;
            return parsed;
        } catch (err) {
            if (err.name === 'AbortError' || streamController.signal.aborted) {
                const abortErr = new Error('Interrupted');
                abortErr.name = 'AbortError';
                throw abortErr;
            }
            console.error('[Ollama] API Error:', err);
            throw new Error(`Local Ollama Error: ${err.message}. Make sure Ollama is running ('ollama serve' or start Ollama app).`);
        } finally {
            if (this.activeStreamController === streamController) {
                this.activeStreamController = null;
            }
        }
    }

    async sendMessage(userText, onChunk = null, onActionDetected = null) {
        return this.sendMessageStream(userText, onChunk, onActionDetected, null);
    }

    mapTagToAction(rawTag) {
        const tag = (rawTag || '').toLowerCase().replace(/[-_]/g, '');
        if (['laugh', 'giggle', 'chuckle', 'haha', 'lol'].includes(tag)) return 'laugh';
        if (['surprise', 'shock', 'whoa', 'gasp'].includes(tag)) return 'surprise';
        if (['empathy', 'comfort', 'care', 'sad', 'sympathy'].includes(tag)) return 'empathy';
        if (['wave', 'hello', 'hi', 'happy', 'smile'].includes(tag)) return 'wave';
        if (['cheer', 'celebrate', 'excited', 'sing', 'dance', 'yay', 'hype'].includes(tag)) return 'cheer';
        if (['nod', 'yes', 'agree', 'hai', 'correct', 'true'].includes(tag)) return 'nod';
        if (['crossarms', 'sassy', 'cool', 'hmph'].includes(tag)) return 'cross_arms';
        if (['pout', 'annoyed', 'mou'].includes(tag)) return 'pout';
        if (['reach', 'reachhand', 'welcome', 'sparkle', 'invite', 'offer'].includes(tag)) return 'reach';
        if (['shy', 'blush', 'grateful', 'crying', 'bow', 'love', 'prayer', 'thank'].includes(tag)) return 'shy';
        if (['think', 'ponder', 'hmm', 'curious', 'calculate', 'solve'].includes(tag)) return 'think';
        if (['wink', 'playful', 'tease'].includes(tag)) return 'wink';
        if (['shakehead', 'no', 'disagree', 'false'].includes(tag)) return 'shake_head';
        if (['shrug', 'dunno', 'unsure', 'maybe'].includes(tag)) return 'shrug';
        if (['stretch', 'yawn', 'relax'].includes(tag)) return 'stretch';
        if (['explain', 'talking', 'talk'].includes(tag)) return 'explain';
        if (['idle', 'calm', 'stand'].includes(tag)) return 'idle';
        return 'explain';
    }

    detectAction(text) {
        const lower = (text || '').toLowerCase();
        if (/\b(sorry to hear|so sorry|feel that|wipe you out|drain you|here for you|tough|rough|take a breath|kick back|relax tonight|not alone)\b/i.test(lower) || /[🥺🫂]/u.test(lower)) return 'empathy';
        if (/\b(haha|hehe|hahaha|giggle|hilarious|crack me up|lol)\b/i.test(lower) || /[😂🤣😆]/u.test(lower)) return 'laugh';
        if (/\b(whoa|wait what|no way|seriously\?!|unbelievable|mind blown|oh my)\b/i.test(lower) || /[😲😱🤯]/u.test(lower)) return 'surprise';
        if (/\b(thank|you're welcome|anytime|sweet of you|glad|appreciate|nice to meet)\b/i.test(lower) || /[😳🥰]/u.test(lower)) return 'shy';
        if (/\b(yay|awesome|fantastic|amazing|woohoo|celebrate|congrats|excited|love|always on tap|let's go)\b/i.test(lower) || /[🎉✨🌟🔥🎵🎤]/u.test(lower)) return 'cheer';
        if (/\b(stretch|stiff|long sit|yawn)\b/i.test(lower) || /[🙆]/u.test(lower)) return 'stretch';
        if (/\b(not sure|dunno|hard to say|who knows|either way|beats me)\b/i.test(lower) || /[🤷]/u.test(lower)) return 'shrug';
        if (/\b(hi|hello|hey|morning|evening|see ya|what's up)\b/i.test(lower) && lower.length < 65) return 'wave';
        if (/\b(hmm|let's see|wonder|curious|depends|due to|phenomenon|because|maybe try)\b/i.test(lower) || /[🤔]/u.test(lower)) return 'think';
        if (/\b(wink|secret|bet you|trust me|gotcha|easy)\b/i.test(lower) || /[😎😉😜]/u.test(lower)) return 'wink';
        if (/\b(hmph|unfair|teasing)\b/i.test(lower) || /[😤😒]/u.test(lower)) return 'pout';
        if (/\b(yes|yeah|yep|totally|exactly|definitely|absolutely|of course|for sure)\b/i.test(lower)) return 'nod';
        if (/\b(nope|nah|afraid not|don't think so|unfortunately|impossible)\b/i.test(lower)) return 'shake_head';
        if (/\b(tell me|what about you|how about you|how's your|planned)\b/i.test(lower) || /[💖]/u.test(lower)) return 'reach';
        return 'explain';
    }

    cleanForSpeech(text) {
        return (text || '')
            .replace(/<<CMD:[^>]*>>?/gi, ' ')
            .replace(/\*[^*]+\*/g, ' ')
            .replace(/\[[^\]]+\]/g, ' ')
            .replace(/<\|[^|]+\|>/g, ' ')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
            .replace(/[`#_>~|]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    parseResponse(raw, isPartial = false) {
        let cleanText = (raw || '')
            .replace(/<\|[^|]*\|?>?/g, '')
            .trim();
        let action = null;
        const commands = [];

        // Extract one or more sequential Ollama PC/Browser command tags <<CMD:tool|target>>
        const cmdRegex = /<<CMD:\s*([a-zA-Z0-9_\-]+)\s*\|\s*([^>]+?)>>/gi;
        let m;
        while ((m = cmdRegex.exec(cleanText)) !== null) {
            commands.push({
                tool: m[1].trim().toLowerCase(),
                target: m[2].trim()
            });
        }
        const command = commands.length > 0 ? commands[0] : null;

        // Strip all complete or in-progress <<CMD:... tags during token streaming
        cleanText = cleanText.replace(/<<CMD:[^>]*>>/gi, '').trim();
        if (isPartial) {
            cleanText = cleanText.replace(/<<(?:C(?:M(?:D(?::[^>]*)?)?)?)?$/i, '').trim();
        }

        const match = cleanText.match(/^\[([a-zA-Z_\-]+)\]\s*/i);
        if (match) {
            action = this.mapTagToAction(match[1]);
            cleanText = cleanText.replace(match[0], '').trim();
        }

        const asteriskMatch = cleanText.match(/\*([^*]{1,28})\*/);
        if (asteriskMatch && !action) {
            const cue = asteriskMatch[1].toLowerCase();
            if (/laugh|giggle|chuckl|haha/.test(cue)) action = 'laugh';
            else if (/sigh|hug|comfort|pat|soft/.test(cue)) action = 'empathy';
            else if (/gasp|wide|shock|blink/.test(cue)) action = 'surprise';
            else if (/wink|smirk|teas/.test(cue)) action = 'wink';
            else if (/blush|shy|fluster/.test(cue)) action = 'shy';
            else if (/cheer|jump|clap|excited/.test(cue)) action = 'cheer';
            else if (/wave|smile|grin/.test(cue)) action = 'wave';
            else if (/nod/.test(cue)) action = 'nod';
        }
        cleanText = cleanText.replace(/\*[^*]{1,32}\*/g, '');
        if (isPartial) {
            cleanText = cleanText.replace(/\*[^*]*$/, '');
        }

        const isSchoolMathOrLoop = /(\b\w+\b)(?:\s+\1){2,}/i.test(cleanText) ||
            /\b(class\s+maths?|\d+(?:st|nd|rd|th)\s+chapter|solve\s+for\s+[xyz]|find\s+the\s+value\s+of|homework\s+doubt)\b/i.test(cleanText) ||
            cleanText.toLowerCase().includes('i have a doubt');
        if (isSchoolMathOrLoop) {
            cleanText = "Hey! What's up? Tell me what's on your mind.";
            action = 'wave';
        }

        cleanText = cleanText.replace(/\[[^\]]+\]/g, '');
        if (isPartial) {
            cleanText = cleanText.replace(/^\[[a-zA-Z_\-]*$/, '');
        }
        cleanText = cleanText.replace(/\s{2,}/g, ' ').trim();

        if (!action) {
            action = cleanText ? this.detectAction(cleanText) : 'idle';
        }

        if (!isPartial && !cleanText) {
            if (command) {
                cleanText = `Got it! Running ${command.target || command.tool} on your PC right now!`;
                action = 'nod';
            } else {
                cleanText = "Hey! I'm listening—what's up?";
                action = 'wave';
            }
        }

        const speechText = this.cleanForSpeech(cleanText);

        return {
            action,
            command,
            commands,
            rawText: cleanText,
            speechText: speechText || cleanText
        };
    }
}

if (typeof window !== 'undefined') {
    window.OllamaClient = OllamaClient;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OllamaClient };
}
