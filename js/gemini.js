/**
 * Gemini API Client for Miku Voice Assistant
 * Powered by Google AI Studio's Interactions API (gemini-3.8-flash)
 * Supports server-side multi-turn state (previous_interaction_id) and automatic fallback.
 */
export class GeminiClient {
    constructor() {
        this.apiKey = (localStorage.getItem('gemini_api_key') || '').trim();
        this.onModelSwitched = null;
        this.onRetryNotice = null;

        // Default to active gemini-3.8-flash
        const saved = localStorage.getItem('gemini_model') || 'gemini-3.8-flash';
        this.model = this.cleanModelName(saved);
        localStorage.setItem('gemini_model', this.model);

        this.lastInteractionId = null;
        this.history = [];
        this.systemInstruction = `You are Hatsune Miku, an intelligent, cheerful, and friendly virtual anime companion.
Answer whatever the user asks directly, accurately, and clearly in 1 to 2 conversational sentences.
Always reply in the exact same language the user speaks or writes in.`;
    }

    cleanModelName(name) {
        let clean = (name || '').trim().replace(/^models\//, '');
        if (clean.includes('2.0') || clean.includes('1.5') || clean.includes('2.5') || !clean) {
            return 'gemini-3.8-flash';
        }
        return clean;
    }

    setApiKey(key) {
        this.apiKey = (key || '').trim();
        localStorage.setItem('gemini_api_key', this.apiKey);
    }

    setModel(modelName) {
        this.model = this.cleanModelName(modelName);
        localStorage.setItem('gemini_model', this.model);
    }

    clearHistory() {
        this.lastInteractionId = null;
        this.history = [];
    }

    /**
     * Query available models associated with the user's API Key
     */
    async listAvailableModels() {
        if (!this.apiKey) return [];
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(this.apiKey)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.models || [])
                .filter(m => m.supportedGenerationMethods?.includes('generateContent') || m.supportedGenerationMethods?.includes('interactions'))
                .map(m => m.name.replace('models/', ''));
        } catch (e) {
            return [];
        }
    }

    /**
     * Run full diagnostic check for a given API key across Interactions API
     */
    async runDiagnostics(testKey) {
        const key = (testKey || this.apiKey || '').trim();
        if (!key) {
            return {
                success: false,
                error: "No API Key provided. Please paste your Gemini key above first."
            };
        }

        const results = {
            success: false,
            keyValid: false,
            availableModels: [],
            modelTests: {},
            recommendedModel: null,
            logs: []
        };

        // 1. Verify key via models endpoint
        try {
            const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
            const listRes = await fetch(listUrl);
            const listData = await listRes.json().catch(() => ({}));

            if (!listRes.ok) {
                let msg = `HTTP ${listRes.status}`;
                if (Array.isArray(listData) && listData[0]?.error?.message) {
                    msg = listData[0].error.message;
                } else if (listData.error?.message) {
                    msg = listData.error.message;
                }
                results.logs.push(`❌ Key validation failed: ${msg}`);
                results.error = msg;
                return results;
            }

            results.keyValid = true;
            results.availableModels = (listData.models || []).map(m => m.name.replace('models/', ''));
            results.logs.push(`✅ Key authenticated! (${results.availableModels.length} models accessible on account)`);
        } catch (e) {
            results.logs.push(`❌ Network error while verifying key: ${e.message}`);
            results.error = e.message;
            return results;
        }

        // 2. Test Interactions API with gemini-3.8-flash
        const candidates = ['gemini-3.8-flash'];
        for (const mod of candidates) {
            const start = performance.now();
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(key)}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': key
                    },
                    body: JSON.stringify({
                        model: mod,
                        input: 'Hello'
                    })
                });
                const elapsed = Math.round(performance.now() - start);
                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    results.modelTests[mod] = { ok: true, status: res.status, latency: elapsed };
                    results.logs.push(`✅ ${mod} (Interactions API): ONLINE & RESPONDING (${elapsed}ms)`);
                    results.recommendedModel = mod;
                } else {
                    const err = data.error?.message || `HTTP ${res.status}`;
                    results.modelTests[mod] = { ok: false, status: res.status, error: err };
                    results.logs.push(`⚠️ ${mod}: HTTP ${res.status} - ${err}`);
                }
            } catch (netErr) {
                results.modelTests[mod] = { ok: false, error: netErr.message };
                results.logs.push(`⚠️ ${mod}: Network error: ${netErr.message}`);
            }
        }

        if (!results.recommendedModel) {
            results.recommendedModel = 'gemini-3.8-flash';
        }

        results.success = true;
        return results;
    }

    async sendMessage(userText) {
        if (!this.apiKey) {
            throw new Error("Gemini API Key is missing. Please click Settings (⚙️) and enter your Gemini API key.");
        }

        return await this._executeWithFailover(userText, 0);
    }

    async _executeWithFailover(userText, retryCount = 0) {
        const activeModel = this.cleanModelName(this.model);

        // 1. Interactions API endpoint
        const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(this.apiKey)}`;

        const interactionPayload = {
            model: activeModel,
            system_instruction: this.systemInstruction,
            input: userText
        };

        if (this.lastInteractionId) {
            interactionPayload.previous_interaction_id = this.lastInteractionId;
        }

        let response;
        try {
            response = await fetch(interactionsUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": this.apiKey
                },
                body: JSON.stringify(interactionPayload)
            });
        } catch (netErr) {
            throw new Error(`Network connection error: ${netErr.message}`);
        }

        // If Interactions API returns 404 (e.g. legacy key or regional endpoint routing), attempt fallback to generateContent
        if (!response.ok && response.status === 404 && !this.lastInteractionId) {
            console.warn("Interactions API returned 404, attempting fallback to generateContent...");
            const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
            const genPayload = {
                systemInstruction: { parts: [{ text: this.systemInstruction }] },
                contents: [{ role: "user", parts: [{ text: userText }] }],
                generationConfig: { temperature: 0.85, topP: 0.95, maxOutputTokens: 300 }
            };
            try {
                const genRes = await fetch(genUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(genPayload)
                });
                if (genRes.ok) response = genRes;
            } catch (e) {
                // Keep original response
            }
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            let errMsg = `HTTP ${response.status} ${response.statusText || ''}`.trim();
            if (Array.isArray(errData) && errData[0]?.error?.message) {
                errMsg = errData[0].error.message;
            } else if (errData.error?.message) {
                errMsg = errData.error.message;
            } else if (errData.message) {
                errMsg = errData.message;
            }
            const lowerErr = errMsg.toLowerCase();

            // Detect high demand and rate limits
            const isHighDemand = 
                response.status === 503 || 
                response.status === 429 || 
                lowerErr.includes('demand') || 
                lowerErr.includes('overload') || 
                lowerErr.includes('capacity') || 
                lowerErr.includes('resource_exhausted') || 
                lowerErr.includes('spikes in demand') ||
                lowerErr.includes('temporarily unavailable');

            // High demand spikes are temporary: retry with exponential backoff on gemini-3.8-flash
            if (isHighDemand && retryCount < 4) {
                const waitMs = (retryCount + 1) * 1500;
                console.warn(`Gemini 3.8 Flash server spike. Retrying in ${waitMs}ms (attempt ${retryCount + 1}/4)...`);
                if (typeof this.onRetryNotice === 'function') {
                    this.onRetryNotice(retryCount + 1, waitMs);
                }
                await new Promise(r => setTimeout(r, waitMs));
                return this._executeWithFailover(userText, retryCount + 1);
            }

            // If error indicates previous_interaction_id is stale or not found, reset it and retry once
            if (this.lastInteractionId && (lowerErr.includes('interaction') || lowerErr.includes('previous') || response.status === 404)) {
                console.warn("Resetting expired interaction ID and retrying fresh conversation...");
                this.lastInteractionId = null;
                return this._executeWithFailover(userText, retryCount + 1);
            }

            throw new Error(`Gemini API Error: ${errMsg}`);
        }

        const data = await response.json();

        // Save server-side state interaction ID for multi-turn chat
        if (data.id) {
            this.lastInteractionId = data.id;
        }

        // Extract output text from Interactions API or fallback
        let rawText = "";
        if (typeof data.output_text === 'string' && data.output_text.trim()) {
            rawText = data.output_text;
        } else if (Array.isArray(data.steps)) {
            for (const step of data.steps) {
                if (step.type === 'model_output' && Array.isArray(step.content)) {
                    for (const block of step.content) {
                        if (block.type === 'text' && block.text) {
                            rawText += block.text;
                        }
                    }
                }
            }
        } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            rawText = data.candidates[0].content.parts[0].text;
        }

        if (!rawText.trim()) {
            rawText = "Miku didn't catch that... can you say that again?";
        }

        return this.parseResponse(rawText);
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
