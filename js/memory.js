/**
 * Persistent Episodic Long-Term Human Memory Engine (100% Local & Private)
 *
 * Extracts and remembers meaningful personal context across sessions:
 * - User's name / nickname
 * - Preferences (drinks, food, music, hobbies, favorites)
 * - Work, study, or current projects
 * - Last interaction timestamp & recent mood
 */
export class MemoryEngine {
    constructor() {
        this.storageKey = 'miku_episodic_memory_v1';
        this.state = this.load();
    }

    load() {
        const fallback = {
            userName: null,
            facts: [],
            lastMood: null,
            lastSeenAt: null,
            totalInteractions: 0
        };
        if (typeof localStorage === 'undefined') return fallback;
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return {
                userName: parsed.userName || null,
                facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 14) : [],
                lastMood: parsed.lastMood || null,
                lastSeenAt: parsed.lastSeenAt || null,
                totalInteractions: parsed.totalInteractions || 0
            };
        } catch (e) {
            return fallback;
        }
    }

    save() {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.state));
        } catch (e) { }
    }

    clear() {
        this.state = {
            userName: null,
            facts: [],
            lastMood: null,
            lastSeenAt: null,
            totalInteractions: 0
        };
        this.save();
    }

    addFact(factText) {
        const clean = (factText || '').trim().replace(/\s{2,}/g, ' ');
        if (!clean || clean.length < 3 || clean.length > 90) return;
        const lower = clean.toLowerCase();
        // Deduplicate similar facts
        this.state.facts = this.state.facts.filter(f => f.toLowerCase() !== lower);
        this.state.facts.push(clean);
        if (this.state.facts.length > 10) {
            this.state.facts = this.state.facts.slice(-10);
        }
    }

    /**
     * Automatically extract personal facts & mood cues from a user message
     */
    observeUserMessage(text) {
        if (!text || typeof text !== 'string') return;
        const trimmed = text.trim();
        this.state.totalInteractions += 1;
        this.state.lastSeenAt = Date.now();

        // 1. Name extraction ("my name is Karan", "call me Alex", "I'm Rahul")
        const nameMatch = trimmed.match(/\b(?:my name is|call me|i am|i'm)\s+([A-Z][a-z]{1,18})\b/i);
        if (nameMatch) {
            const candidate = nameMatch[1];
            const stopWords = new Set([
                'tired', 'tiring', 'exhausted', 'bored', 'happy', 'sad', 'good', 'fine', 'great',
                'doing', 'just', 'super', 'really', 'working', 'going', 'here', 'back', 'ready',
                'not', 'pretty', 'feeling', 'hungry', 'sleepy', 'stressed', 'busy', 'chilling', 'miku'
            ]);
            if (!stopWords.has(candidate.toLowerCase())) {
                this.state.userName = candidate.charAt(0).toUpperCase() + candidate.slice(1);
            }
        }

        // 2. Preferences ("I love ...", "my favorite ... is ...", "I prefer ...")
        const prefMatch = trimmed.match(/\b(?:i (?:really )?(?:love|like|prefer|enjoy)|my fav(?:ou?rite)? [\w\s]{2,18} is)\s+([^.,!?\n]{2,45})/i);
        if (prefMatch) {
            this.addFact(`Likes/prefers ${prefMatch[1].trim()}`);
        }

        // 3. Work / study / project ("I work as ...", "I'm working on ...", "I'm studying ...")
        const workMatch = trimmed.match(/\b(?:i work (?:as|at|in)|i'm working on|i am working on|i'm studying|i study)\s+([^.,!?\n]{2,50})/i);
        if (workMatch) {
            this.addFact(`Works/studies: ${workMatch[1].trim()}`);
        }

        // 4. Mood tracking
        const lower = trimmed.toLowerCase();
        if (/\b(tired|tiring|exhausted|stressed|rough day|bad day|sad|overwhelmed)\b/.test(lower)) {
            this.state.lastMood = 'tired/stressed';
        } else if (/\b(great|awesome|excited|happy|amazing|good day)\b/.test(lower)) {
            this.state.lastMood = 'upbeat';
        }

        this.save();
    }

    /**
     * Compact ~15-35 token memory context block injected into system prompt
     */
    buildPromptContext() {
        const parts = [];
        if (this.state.userName) {
            parts.push(`User's name: ${this.state.userName}`);
        }
        if (this.state.facts.length > 0) {
            parts.push(`Known about user: ${this.state.facts.slice(-5).join('; ')}`);
        }
        if (!parts.length) return '';
        return `\nMemory (${parts.join(' | ')}). Use naturally only when relevant.`;
    }

    /**
     * Natural human time-of-day greeting personalized with memory
     */
    getPersonalizedGreeting() {
        const hour = new Date().getHours();
        const namePart = this.state.userName ? `, ${this.state.userName}` : '';
        if (hour >= 5 && hour < 12) {
            return `Morning${namePart}! Hope your day's off to a good start—what's up?`;
        } else if (hour >= 12 && hour < 17) {
            return `Hey${namePart}! How's your afternoon going so far?`;
        } else if (hour >= 17 && hour < 22) {
            return `Hey${namePart}! How was your day today?`;
        } else {
            return `Hey${namePart}! Up late tonight? What's on your mind?`;
        }
    }

    getSummaryItems() {
        const items = [];
        if (this.state.userName) items.push(`Name: ${this.state.userName}`);
        this.state.facts.forEach(f => items.push(f));
        if (this.state.lastMood) items.push(`Recent vibe: ${this.state.lastMood}`);
        return items;
    }
}

if (typeof window !== 'undefined') {
    window.MemoryEngine = MemoryEngine;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MemoryEngine };
}
