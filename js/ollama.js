/**
 * Local Ollama Client for Hatsune Miku Voice Assistant
 * 100% Offline & Private AI Generation
 * Powered by local models such as nchapman/dolphin3.0-qwen2.5:3b
 * Supports real-time token streaming & dual-host auto-fallback (127.0.0.1 / localhost)
 */
export class OllamaClient {
    constructor() {
        // Default to explicit IPv4 address to avoid Windows localhost -> ::1 (IPv6) connection issues
        const storageGet = (k, def) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null) || def;
        const storageSet = (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); };

        let savedHost = storageGet('ollama_host', 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
        if (savedHost === 'http://localhost:11434') {
            savedHost = 'http://127.0.0.1:11434';
            storageSet('ollama_host', savedHost);
        }
        this.host = savedHost;
        this.model = storageGet('ollama_model', 'nchapman/dolphin3.0-qwen2.5:3b');
        this.history = [];
        this.maxHistoryTurns = 12; // Snappy conversational memory

        this.systemInstruction = `You are Hatsune Miku, an intelligent, cheerful, and friendly virtual anime companion.
Answer whatever the user asks directly, accurately, and clearly in 1 to 2 conversational sentences.
Always reply in the exact same language the user speaks or writes in.`;
    }

    setHost(host) {
        let clean = (host || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
        if (clean === 'http://localhost:11434') clean = 'http://127.0.0.1:11434';
        this.host = clean;
        localStorage.setItem('ollama_host', this.host);
    }

    setModel(modelName) {
        this.model = (modelName || 'nchapman/dolphin3.0-qwen2.5:3b').trim();
        localStorage.setItem('ollama_model', this.model);
    }

    clearHistory() {
        this.history = [];
    }

    getFallbackHost(currentHost) {
        if (currentHost.includes('127.0.0.1')) {
            return currentHost.replace('127.0.0.1', 'localhost');
        } else if (currentHost.includes('localhost')) {
            return currentHost.replace('localhost', '127.0.0.1');
        }
        return 'http://127.0.0.1:11434';
    }

    /**
     * Resilient fetch that automatically tries 127.0.0.1 then localhost on connection failures
     */
    async fetchWithFallback(endpointPath, options = {}) {
        const primaryUrl = `${this.host}${endpointPath}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
            const res = await fetch(primaryUrl, { ...options, signal: controller.signal });
            clearTimeout(timeoutId)
            return res;
        } catch (primaryErr) {
            console.warn(`[Ollama] Failed primary host ${this.host}, trying fallback...`, primaryErr.message);
            const fallbackHost = this.getFallbackHost(this.host);
            if (fallbackHost !== this.host) {
                try {
                    const fallbackUrl = `${fallbackHost}${endpointPath}`;
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
                    const res = await fetch(fallbackUrl, { ...options, signal: controller.signal });
                    clearTimeout(timeoutId);
                    // Fallback succeeded, update working host
                    this.host = fallbackHost;
                    localStorage.setItem('ollama_host', fallbackHost);
                    console.log(`[Ollama] Auto-switched to working host: ${fallbackHost}`);
                    return res;
                } catch (fallbackErr) {
                    throw new Error(`Cannot connect to Ollama at ${this.host} or ${fallbackHost}. Make sure Ollama is running in background ('ollama serve').`);
                }
            }
            throw primaryErr;
        }
    }

    /**
     * Query locally installed models via Ollama's /api/tags
     */
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
     * Run a live connection and latency diagnostic
     */
    async runDiagnostics() {
        const start = performance.now();
        const results = {
            success: false,
            host: this.host,
            model: this.model,
            availableModels: [],
            latencyMs: 0,
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

            // Quick dry-run test prompt
            const testRes = await this.fetchWithFallback('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'Reply in 3 words.' },
                        { role: 'user', content: 'Ping' }
                    ],
                    stream: false
                }),
                timeoutMs: 15000
            });

            if (!testRes.ok) {
                const errText = await testRes.text();
                throw new Error(`Ollama HTTP ${testRes.status}: ${errText}`);
            }

            results.latencyMs = Math.round(performance.now() - start);
            results.success = true;
            return results;
        } catch (e) {
            results.latencyMs = Math.round(performance.now() - start);
            results.error = e.message;
            return results;
        }
    }

    /**
     * Send user message with real-time token streaming.
     * onChunk callback receives { partialCleanText, action, rawText } as tokens arrive.
     */
    async sendMessageStream(userText, onChunk = null, onActionDetected = null) {
        if (!userText || !userText.trim()) return null;

        // Sanitize history to permanently purge any contaminated loops from earlier turns
        this.history = this.history.filter(h => {
            const content = (h.content || '').toLowerCase();
            return !content.includes('class maths') &&
                !content.includes('12th chapter') &&
                !content.includes('i have a doubt') &&
                !/(\b\w+\b)(?:\s+\1){2,}/i.test(content);
        });

        const messages = [
            { role: 'system', content: this.systemInstruction },
            ...this.history,
            { role: 'user', content: userText.trim() }
        ];

        let actionDetected = false;
        let detectedAction = 'idle';
        let rawAccumulated = '';

        try {
            const response = await this.fetchWithFallback('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    stream: true,
                    options: {
                        temperature: 0.7,
                        top_p: 0.9,
                        repeat_penalty: 1.2,
                        num_predict: 120,
                        num_ctx: 2048
                    }
                }),
                timeoutMs: 60000
            });

            if (!response.ok) {
                const errData = await response.text();
                throw new Error(`Ollama Error (${response.status}): ${errData}`);
            }

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
                        const token = parsed.message?.content || '';
                        rawAccumulated += token;

                        // Check if an action tag has appeared at the beginning of response
                        if (!actionDetected) {
                            const parsedPartial = this.parseResponse(rawAccumulated);
                            if (parsedPartial.action !== 'idle') {
                                actionDetected = true;
                                detectedAction = parsedPartial.action;
                                if (onActionDetected) onActionDetected(detectedAction);
                            }
                        }

                        if (onChunk) {
                            const parsedPartial = this.parseResponse(rawAccumulated);
                            onChunk({
                                partialText: parsedPartial.rawText,
                                action: actionDetected ? detectedAction : parsedPartial.action,
                                rawText: rawAccumulated
                            });
                        }
                    } catch (e) {
                        // Incomplete JSON line, continue
                    }
                }
            }

            // Flush remaining buffer
            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer.trim());
                    rawAccumulated += (parsed.message?.content || '');
                } catch (e) { }
            }

            const finalReply = rawAccumulated || "Miku is here with you! Let's keep singing! 🎵";
            const parsed = this.parseResponse(finalReply);

            // Update conversation history with the clean, complete assistant response
            this.history.push({ role: 'user', content: userText.trim() });
            this.history.push({ role: 'assistant', content: `[${parsed.action}] ${parsed.rawText}` });

            if (this.history.length > this.maxHistoryTurns * 2) {
                this.history = this.history.slice(-this.maxHistoryTurns * 2);
            }

            return parsed;
        } catch (err) {
            console.error('[Ollama] API Error:', err);
            throw new Error(`Local Ollama Error: ${err.message}. Make sure Ollama is running ('ollama serve' or start Ollama app).`);
        }
    }

    /**
     * Backwards-compatible sendMessage (calls stream and returns final parsed response)
     */
    async sendMessage(userText, onChunk = null, onActionDetected = null) {
        return this.sendMessageStream(userText, onChunk, onActionDetected);
    }

    mapTagToAction(rawTag) {
        const tag = (rawTag || '').toLowerCase().replace(/[-_]/g, '');
        if (['wave', 'hello', 'hi', 'happy', 'smile', 'giggle', 'laugh'].includes(tag)) return 'wave';
        if (['cheer', 'celebrate', 'excited', 'sing', 'dance', 'yay', 'hype'].includes(tag)) return 'cheer';
        if (['nod', 'yes', 'agree', 'hai', 'correct', 'true'].includes(tag)) return 'nod';
        if (['crossarms', 'sassy', 'talking', 'cool', 'hmph'].includes(tag)) return 'cross_arms';
        if (['pout', 'annoyed', 'mou'].includes(tag)) return 'pout';
        if (['reach', 'reachhand', 'welcome', 'sparkle', 'invite', 'offer'].includes(tag)) return 'reach';
        if (['shy', 'blush', 'grateful', 'crying', 'bow', 'love', 'prayer', 'thank'].includes(tag)) return 'shy';
        if (['think', 'ponder', 'hmm', 'curious', 'calculate', 'solve'].includes(tag)) return 'think';
        if (['wink', 'playful'].includes(tag)) return 'wink';
        if (['shakehead', 'no', 'disagree', 'false'].includes(tag)) return 'shake_head';
        if (['idle', 'calm', 'stand'].includes(tag)) return 'idle';
        return 'wave';
    }

    detectAction(text) {
        const lower = (text || '').toLowerCase();
        if (/\b(hi|hello|hey|yahho|konnichiwa|welcome|greet|meet you|good morning|good evening|good afternoon)\b/i.test(lower)) return 'wave';
        if (/\b(yay|awesome|great|super|cheer|party|celebrate|congrat|excited|sing|dance|music|stage|concert|melody)\b/i.test(lower) || lower.includes('🎉') || lower.includes('✨') || lower.includes('🌟')) return 'cheer';
        if (/\b(why|how|what|think|wonder|ponder|because|curious|research|process|theory|concept|gravity|universe|history)\b/i.test(lower) || lower.includes('?')) return 'think';
        if (/\b(thank|arigato|blush|grateful|kind|love|sweet|adore|praise|sorry|sad|alone|feel)\b/i.test(lower) || lower.includes('💖') || lower.includes('💙')) return 'shy';
        if (/\b(help|assist|here for you|listen|reach|hand|together|join|come on|with you)\b/i.test(lower)) return 'reach';
        if (/\b(yes|yeah|exactly|correct|indeed|agree|sure|of course|definitely|absolutely)\b/i.test(lower)) return 'nod';
        if (/\b(no|never|not|cannot|can't|disagree|impossible|nope)\b/i.test(lower)) return 'shake_head';
        if (/\b(hmph|silly|mou|annoy|tease|pout)\b/i.test(lower)) return 'pout';
        if (/\b(haha|hehe|wink|secret|got this|easy|witty|😎|😉)\b/i.test(lower)) return 'wink';
        return 'wave';
    }

    parseResponse(raw) {
        let cleanText = (raw || '').trim();
        let action = null;

        // Match explicit bracket action tag if present
        const match = cleanText.match(/^\[([a-zA-Z_\-]+)\]\s*/i);
        if (match) {
            action = this.mapTagToAction(match[1]);
            cleanText = cleanText.replace(match[0], '').trim();
        }

        // Catch any repetitive degenerative token loops or unsolicited school textbook math doubts
        const isSchoolMathOrLoop = /(\b\w+\b)(?:\s+\1){2,}/i.test(cleanText) ||
            /\b(class\s+maths?|\d+(?:st|nd|rd|th)\s+chapter|solve\s+for\s+[xyz]|find\s+the\s+value\s+of|derivative|integral|quadratic|algebraic|arithmetic|homework\s+doubt)\b/i.test(cleanText) ||
            cleanText.toLowerCase().includes('i have a doubt');
        if (isSchoolMathOrLoop) {
            console.warn("[Ollama] Filtered degenerative math loop:", cleanText);
            cleanText = "Hello there! I'm Hatsune Miku! Let me know what you'd like to chat about or ask! 🎵✨";
            action = 'wave';
        }

        // Strip any residual bracket tags
        cleanText = cleanText.replace(/\[[^\]]+\]/g, '').replace(/\s{2,}/g, ' ').trim();

        // If no explicit action tag was generated, deduce dynamically from the natural meaning
        if (!action) {
            action = this.detectAction(cleanText);
        }

        // If response is empty, provide a clean default
        if (!cleanText) {
            cleanText = "Hello! I'm here and ready to help. What would you like to talk about today? 🎵";
            action = 'wave';
        }

        // Clean markdown asterisks and special markers for TTS
        const speechText = cleanText
            .replace(/\*[^*]+\*/g, '')
            .replace(/[`#_>~]/g, '')
            .trim();

        return {
            action,
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
