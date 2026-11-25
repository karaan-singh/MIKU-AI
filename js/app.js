import { GeminiClient } from './gemini.js?v=20261125c';
import { OllamaClient } from './ollama.js?v=20261125c';
import { TTSEngine } from './tts.js?v=20261125c';
import { STTEngine } from './stt.js?v=20261125c';
import { Miku3D } from './miku3d.js?v=20261125c';
import { AvatarEngine } from './avatar.js?v=20261125c';
import { AudioVisualizer } from './audio.js?v=20261125c';
import { MemoryEngine } from './memory.js?v=20261125c';
import { PerceptionEngine } from './perception.js?v=20261125c';

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class MikuApp {
    constructor() {
        this.status = 'idle';
        this.viewMode = localStorage.getItem('miku_view_mode') || '3d';

        // Persistent Episodic Memory (100% Local)
        this.memory = new MemoryEngine();

        // AI Provider: default to 'ollama' for 100% offline local miku-human / Qwen AI
        this.aiProvider = localStorage.getItem('ai_provider') || 'ollama';
        this.ollama = new OllamaClient();
        this.ollama.clearHistory();
        this.gemini = new GeminiClient();
        this.syncMemoryToBrains();

        this.gemini.onModelSwitched = (oldModel, newModel, reason) => {
            console.log(`Auto-switched Gemini model from ${oldModel} to ${newModel} due to ${reason}`);
            this.setStatus('thinking', `Using ${newModel}...`);
            const modelSelect = document.getElementById('cfg-model');
            if (modelSelect) {
                const optValues = Array.from(modelSelect.options).map(o => o.value);
                if (optValues.includes(newModel)) {
                    modelSelect.value = newModel;
                }
            }
        };
        this.gemini.onRetryNotice = (attempt, waitMs) => {
            const secs = Math.round(waitMs / 1000);
            this.setStatus('thinking', `High traffic spike on Gemini 3.8 Flash, retrying in ${secs}s (${attempt}/4)...`);
        };

        // 3D Human-Like Character Container
        this.container3D = document.getElementById('avatar-3d-container');
        this.miku3D = new Miku3D(this.container3D);

        // 2D Illustrated Mode Container
        this.container2D = document.getElementById('avatar-2d-container');
        this.avatar2D = new AvatarEngine(this.container2D);

        // Web Audio F1/F2 Formant Analyzer & Visualizer (shared with TTSEngine!)
        this.vizCanvas = document.getElementById('audio-visualizer-canvas');
        this.visualizer = new AudioVisualizer(this.vizCanvas);
        this.tts = new TTSEngine(this.visualizer);
        this.stt = new STTEngine();

        // Local Webcam Eye-Contact Tracker
        this.perception = new PerceptionEngine((head) => {
            if (this.miku3D) {
                this.miku3D.setViewerGaze(head.x, head.y, true);
            }
        });

        // UI Elements
        this.statusBadge = document.getElementById('status-badge');
        this.statusText = document.getElementById('status-text');
        this.dialogueCard = document.getElementById('dialogue-card');
        this.speakerName = document.getElementById('speaker-name');
        this.subtitleText = document.getElementById('subtitle-text');
        this.latencyTelemetry = document.getElementById('latency-telemetry');
        this.userInput = document.getElementById('user-text-input');
        this.sendBtn = document.getElementById('send-btn');
        this.micBtn = document.getElementById('mic-btn');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsModal = document.getElementById('settings-modal');
        this.closeSettingsBtn = document.getElementById('close-settings-btn');
        this.viewModeToggle = document.getElementById('view-mode-toggle');
        this.brainToggleBtn = document.getElementById('brain-toggle-btn');
        this.pcControlBtn = document.getElementById('pc-control-btn');
        this.eyeContactBtn = document.getElementById('eye-contact-btn');
        this.handsFreeBtn = document.getElementById('hands-free-btn');

        // PC Control & Saved Commands Modal Elements
        this.pcCommandsModal = document.getElementById('pc-commands-modal');
        this.closePcCommandsBtn = document.getElementById('close-pc-commands-btn');
        this.btnClosePcCommands = document.getElementById('btn-close-pc-commands');
        this.savedCommandsList = document.getElementById('saved-commands-list');
        this.pcAppsBadge = document.getElementById('pc-apps-badge');

        // Written text & Voice Controls
        this.dialogueUserPrompt = document.getElementById('dialogue-user-prompt');
        this.dialogueUserText = document.getElementById('dialogue-user-text');
        this.btnReplayVoice = document.getElementById('btn-replay-voice');
        this.btnSoundCheck = document.getElementById('btn-sound-check');
        this.btnCopyReply = document.getElementById('btn-copy-reply');
        this.btnToggleChatLog = document.getElementById('btn-toggle-chat-log');
        this.chatHistoryModal = document.getElementById('chat-history-modal');
        this.chatHistoryList = document.getElementById('chat-history-list');
        this.closeChatHistoryBtn = document.getElementById('close-chat-history-btn');
        this.btnCloseChatHistory = document.getElementById('btn-close-chat-history');
        this.btnClearChatHistory = document.getElementById('btn-clear-chat-history');

        this.typingIdleTimer = null;
        this.lastTypingNodAt = 0;
        this.lastUserActivityAt = Date.now();
        this.proactiveTimer = null;

        const greeting = this.memory.getPersonalizedGreeting();
        this.chatTurns = [];
        this.lastMikuResponse = {
            action: 'wave',
            rawText: greeting,
            speechText: greeting
        };

        this.init();
    }

    syncMemoryToBrains() {
        const ctx = this.memory.buildPromptContext();
        this.ollama.setMemoryContext(ctx);
        this.gemini.setMemoryContext(ctx);
    }

    getAiClient() {
        return this.aiProvider === 'ollama' ? this.ollama : this.gemini;
    }

    isModalOpen() {
        return (this.settingsModal && this.settingsModal.classList.contains('active')) ||
            (this.chatHistoryModal && this.chatHistoryModal.classList.contains('active')) ||
            (this.pcCommandsModal && this.pcCommandsModal.classList.contains('active'));
    }

    getServerBase() {
        return this.tts.serverAvailable ? (this.tts.serverBaseUrl || '') : 'http://127.0.0.1:8080';
    }

    async callPcApi(path, method = 'GET', bodyObj = null) {
        try {
            const base = this.getServerBase();
            const opts = { method, headers: {} };
            if (bodyObj) {
                opts.headers['Content-Type'] = 'application/json';
                opts.body = JSON.stringify(bodyObj);
            }
            const res = await fetch(`${base}${path}`, opts);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    async renderSavedCommands() {
        if (!this.savedCommandsList) return;
        const data = await this.callPcApi('/api/pc/saved', 'GET');
        if (!data || !data.ok) {
            this.savedCommandsList.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">Desktop server offline—run start.bat or python server.py to enable PC controls.</span>';
            return;
        }
        if (this.pcAppsBadge) {
            this.pcAppsBadge.textContent = `✅ ${data.installedAppsCount} PC Apps Indexed`;
        }
        const sandboxBanner = document.getElementById('desktop-sandbox-banner');
        if (sandboxBanner) {
            sandboxBanner.style.display = data.interactiveDesktop === false ? 'block' : 'none';
        }
        const items = data.savedCommands || [];
        if (!items.length) {
            this.savedCommandsList.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 10px 4px;">No saved commands yet—ask Miku to open YouTube, search the browser, or launch an app, and she will auto-save it here!</div>';
            return;
        }

        this.savedCommandsList.innerHTML = '';
        items.forEach((cmd) => {
            const row = document.createElement('div');
            row.className = 'saved-cmd-item';
            row.innerHTML = `
                <div class="saved-cmd-meta">
                    <span class="saved-cmd-phrase">"${escapeHtml(cmd.phrase)}"</span>
                    <span class="saved-cmd-detail">${escapeHtml(cmd.tool)} → ${escapeHtml(cmd.target)} • ⚡ ${cmd.hits || 1}x</span>
                </div>
                <button class="dialogue-action-btn btn-run-saved" style="flex-shrink: 0;">▶ Run</button>
            `;
            row.querySelector('.btn-run-saved').addEventListener('click', async () => {
                this.tts.primeAudio();
                this.closePcCommands();
                const execRes = await this.callPcApi('/api/pc/execute', 'POST', {
                    tool: cmd.tool,
                    target: cmd.target,
                    steps: cmd.steps || null,
                    phrase: cmd.phrase,
                    reply: cmd.reply,
                    execute: true,
                    save: true
                });
                if (execRes) {
                    const spoken = (cmd.tool === 'pc_status' || cmd.tool === 'screenshot')
                        ? (execRes.reply || cmd.reply)
                        : (cmd.reply || execRes.reply);
                    this.updateLatencyPill(`⚡ ${execRes.latencyMs || 2}ms Saved Command`, true);
                    this.handleMikuResponse({
                        action: execRes.action || 'nod',
                        rawText: spoken,
                        speechText: spoken
                    });
                }
            });
            this.savedCommandsList.appendChild(row);
        });
    }

    openPcCommands() {
        this.renderSavedCommands();
        if (this.pcCommandsModal) this.pcCommandsModal.classList.add('active');
    }

    closePcCommands() {
        if (this.pcCommandsModal) this.pcCommandsModal.classList.remove('active');
    }

    updateLatencyPill(text, highlight = false) {
        if (!this.latencyTelemetry) return;
        if (!text) {
            this.latencyTelemetry.style.display = 'none';
            return;
        }
        this.latencyTelemetry.style.display = 'inline-flex';
        this.latencyTelemetry.textContent = text;
        this.latencyTelemetry.style.color = highlight ? 'var(--miku-cyan)' : 'var(--miku-teal)';
    }

    async init() {
        this.applyViewMode(this.viewMode);
        this.bindUserControls();
        this.bindDialogueActions();
        this.bindMotionControls();
        this.bindSettings();
        this.updateBrainToggleUI();
        this.updateHandsFreeUI();
        this.renderMemoryBank();
        this.startProactiveLifeLoop();

        // Immediately display personalized episodic greeting (0ms synchronous, before async Ollama ping!)
        const greeting = this.memory.getPersonalizedGreeting();
        this.showSubtitle("Miku", greeting, 'happy');
        this.addChatTurn('miku', greeting, 'wave', greeting);
        this.executeMotion('wave');

        // Prime hardware audio output on any pointer, touch, click, or key gesture
        const unlockAudio = () => {
            this.tts.primeAudio();
            this.visualizer.ensureAudioContext();
        };
        ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach((evt) => {
            window.addEventListener(evt, unlockAudio, { once: true, passive: true });
        });

        const touchActivity = () => { this.lastUserActivityAt = Date.now(); };
        window.addEventListener('mousemove', touchActivity, { passive: true });
        window.addEventListener('keydown', touchActivity, { passive: true });

        // Detect local Ollama, auto-prefer compiled `miku-human:latest`, & silently pre-warm in RAM!
        try {
            const models = await this.ollama.listAvailableModels();
            if (models && models.length > 0) {
                console.log(`[Init] Local Ollama detected with ${models.length} models:`, models);

                const hasMikuHuman = models.some(m => m === 'miku-human:latest' || m === 'miku-human');
                if (hasMikuHuman && !localStorage.getItem('miku_human_autoupgraded_v1')) {
                    this.ollama.setModel('miku-human:latest');
                    localStorage.setItem('miku_human_autoupgraded_v1', 'true');
                } else if (!models.includes(this.ollama.model)) {
                    const fallbackChat = hasMikuHuman
                        ? 'miku-human:latest'
                        : (models.find(m => !m.endsWith('-base')) || this.ollama.model);
                    this.ollama.setModel(fallbackChat);
                }

                if (!localStorage.getItem('ai_provider') || (this.aiProvider === 'gemini' && !this.gemini.apiKey)) {
                    this.aiProvider = 'ollama';
                    localStorage.setItem('ai_provider', 'ollama');
                }
                if (this.aiProvider === 'ollama' && this.ollama.turboMode) {
                    this.updateLatencyPill('⚡ Warming Neural Core...');
                    this.ollama.warmUpModel().then((ok) => {
                        if (ok && this.aiProvider === 'ollama') {
                            this.updateLatencyPill('⚡ Instant Warm Ready', true);
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[Init] Local Ollama ping failed:', e.message);
        }

        this.updateBrainToggleUI();

        if (this.aiProvider === 'ollama') {
            this.setStatus('idle', `Ollama: ${this.ollama.model}`);
        } else {
            if (!this.gemini.apiKey) {
                this.setStatus('idle', 'Gemini API Key required');
                setTimeout(() => { this.openSettings(true); }, 600);
            } else {
                this.setStatus('idle', `Gemini: ${this.gemini.model}`);
            }
        }
    }

    /**
     * Autonomous Human Idle Companion Presence:
     * When sitting quietly together for >50s, Miku occasionally stretches her shoulders or shifts thoughtfully!
     */
    startProactiveLifeLoop() {
        if (this.proactiveTimer) clearInterval(this.proactiveTimer);
        this.proactiveTimer = setInterval(() => {
            if (this.status !== 'idle' || this.viewMode !== '3d' || this.tts.isSpeaking) return;
            const idleMs = Date.now() - this.lastUserActivityAt;
            if (idleMs > 50000 && this.miku3D.currentAction === 'idle') {
                this.lastUserActivityAt = Date.now() - 15000;
                const lifeActions = ['stretch', 'shrug', 'think'];
                const pick = lifeActions[Math.floor(Math.random() * lifeActions.length)];
                this.executeMotion(pick);
                if (pick === 'think') {
                    setTimeout(() => {
                        if (this.status === 'idle' && this.miku3D.currentAction === 'think') {
                            this.executeMotion('idle');
                        }
                    }, 4200);
                }
            }
        }, 12000);
    }

    updateBrainToggleUI() {
        if (!this.brainToggleBtn) return;
        if (this.aiProvider === 'ollama') {
            this.brainToggleBtn.textContent = '🦙 Ollama (Offline)';
            this.brainToggleBtn.title = `Active Engine: Local Ollama (${this.ollama.model}). Click to switch to Gemini Cloud.`;
            this.brainToggleBtn.style.borderColor = 'var(--miku-cyan)';
            this.brainToggleBtn.style.color = 'var(--miku-cyan)';
        } else {
            this.brainToggleBtn.textContent = '☁️ Gemini (Cloud)';
            this.brainToggleBtn.title = 'Active Engine: Google Gemini Cloud. Click to switch to Local Ollama.';
            this.brainToggleBtn.style.borderColor = 'var(--miku-pink)';
            this.brainToggleBtn.style.color = 'var(--miku-pink)';
            this.updateLatencyPill('');
        }
    }

    updateHandsFreeUI() {
        const active = this.stt.handsFreeMode;
        if (this.handsFreeBtn) {
            this.handsFreeBtn.classList.toggle('active', active);
            this.handsFreeBtn.textContent = active ? '🎙️ Hands-Free: ON' : '🎙️ Hands-Free';
        }
        const hfCheck = document.getElementById('cfg-hands-free');
        if (hfCheck) hfCheck.checked = active;
    }

    renderMemoryBank() {
        const box = document.getElementById('memory-bank-list');
        if (!box) return;
        const items = this.memory.getSummaryItems();
        if (!items.length) {
            box.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">Tell Miku your name, favorite drinks/music, or what you\'re working on—she\'ll remember across sessions!</span>';
            return;
        }
        box.innerHTML = items.map(item => `<span class="memory-chip">${escapeHtml(item)}</span>`).join('');
    }

    setAiProvider(provider) {
        this.aiProvider = provider;
        localStorage.setItem('ai_provider', provider);
        this.updateBrainToggleUI();

        const providerSelect = document.getElementById('cfg-ai-provider');
        if (providerSelect) {
            providerSelect.value = provider;
            providerSelect.dispatchEvent(new Event('change'));
        }

        if (provider === 'ollama') {
            this.setStatus('idle', `Ollama: ${this.ollama.model}`);
            this.showSubtitle("Miku", `Switched to local AI (${this.ollama.model})!`, 'happy');
            this.executeMotion('wave');
            if (this.ollama.turboMode) {
                this.ollama.warmUpModel().then((ok) => {
                    if (ok) this.updateLatencyPill('⚡ Instant Warm Ready', true);
                });
            }
        } else {
            this.setStatus('idle', `Gemini: ${this.gemini.model}`);
            this.showSubtitle("Miku", `Switched to Google Gemini Cloud (${this.gemini.model})!`, 'happy');
            this.executeMotion('wave');
        }
    }

    applyViewMode(mode) {
        this.viewMode = mode;
        localStorage.setItem('miku_view_mode', mode);

        if (mode === '3d') {
            this.container3D.style.display = 'block';
            this.container2D.style.display = 'none';
            if (this.viewModeToggle) this.viewModeToggle.textContent = '2D Mode 🎨';
            if (this.miku3D) {
                this.miku3D.handleResize();
            }
        } else {
            this.container3D.style.display = 'none';
            this.container2D.style.display = 'flex';
            if (this.viewModeToggle) this.viewModeToggle.textContent = '3D Mode 🌟';
        }
    }


    setStatus(status, message) {
        this.status = status;
        this.statusBadge.className = `status-pill ${status}`;
        this.statusText.textContent = message || status.toUpperCase();

        if (status === 'listening') {
            this.micBtn.classList.add('active');
        } else {
            this.micBtn.classList.remove('active');
        }
    }

    executeMotion(actionName) {
        const motionBtns = document.querySelectorAll('.motion-btn');
        motionBtns.forEach(b => {
            if (b.dataset.action === actionName ||
                (b.dataset.action === 'cross_arms' && actionName === 'crossArms') ||
                (b.dataset.action === 'reach' && actionName === 'reachHand') ||
                (b.dataset.action === 'shake_head' && actionName === 'shakeHead')) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });

        if (this.viewMode === '3d') {
            this.miku3D.setAction(actionName);
        } else {
            const poseMap = {
                wave: 'happy',
                reach: 'happy',
                cheer: 'happy',
                celebrate: 'happy',
                laugh: 'happy',
                wink: 'happy',
                explain: 'happy',
                stretch: 'happy',
                shrug: 'neutral',
                cross_arms: 'neutral',
                surprise: 'happy',
                shy: 'shy',
                empathy: 'shy',
                listen: 'neutral',
                think: 'shy',
                pout: 'neutral',
                idle: 'neutral'
            };
            this.avatar2D.setPose(poseMap[actionName] || 'neutral');
        }
    }

    bindUserControls() {
        this.sendBtn.addEventListener('click', () => {
            this.tts.primeAudio();
            this.handleUserSubmit();
        });

        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                clearTimeout(this.typingIdleTimer);
                this.tts.primeAudio();
                this.handleUserSubmit();
            }
        });

        // Human Typing Presence: Miku attentively notices you typing and gives subtle backchannel micro-nods!
        this.userInput.addEventListener('input', () => {
            this.lastUserActivityAt = Date.now();
            if (this.status !== 'idle') return;
            const val = this.userInput.value;
            if (val.length === 1 && this.miku3D.currentAction === 'idle') {
                this.miku3D.listenPose();
            } else if (val.length > 0 && performance.now() - this.lastTypingNodAt > 2400) {
                this.lastTypingNodAt = performance.now();
                this.miku3D.triggerBackchannelNod();
            }

            clearTimeout(this.typingIdleTimer);
            this.typingIdleTimer = setTimeout(() => {
                if (this.status === 'idle' && !this.userInput.value.trim()) {
                    this.miku3D.resetToIdle();
                }
            }, 4000);
        });

        // Desktop Control & Saved Fast Commands Header Button
        if (this.pcControlBtn) {
            this.pcControlBtn.addEventListener('click', () => this.openPcCommands());
        }
        if (this.closePcCommandsBtn) {
            this.closePcCommandsBtn.addEventListener('click', () => this.closePcCommands());
        }
        if (this.btnClosePcCommands) {
            this.btnClosePcCommands.addEventListener('click', () => this.closePcCommands());
        }
        if (this.pcCommandsModal) {
            this.pcCommandsModal.addEventListener('click', (e) => {
                if (e.target === this.pcCommandsModal) this.closePcCommands();
            });
            this.pcCommandsModal.querySelectorAll('.pc-quick-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    this.tts.primeAudio();
                    const tool = btn.dataset.tool;
                    const target = btn.dataset.target;
                    this.closePcCommands();
                    const res = await this.callPcApi('/api/pc/execute', 'POST', {
                        tool,
                        target,
                        execute: true,
                        save: false
                    });
                    if (res && res.reply) {
                        this.updateLatencyPill(`⚡ ${res.latencyMs || 3}ms PC Action`, true);
                        this.handleMikuResponse({
                            action: res.action || 'nod',
                            rawText: res.reply,
                            speechText: res.reply
                        });
                    }
                });
            });
        }

        // Webcam Eye-Contact Header Toggle
        if (this.eyeContactBtn) {
            this.eyeContactBtn.addEventListener('click', async () => {
                if (this.perception.active) {
                    this.perception.stop();
                    this.miku3D.setViewerGaze(0, 0, false);
                    this.eyeContactBtn.classList.remove('active');
                    this.eyeContactBtn.textContent = '👁️ Eye Contact';
                    this.setStatus('idle', 'Cursor gaze active');
                } else {
                    try {
                        await this.perception.start();
                        this.eyeContactBtn.classList.add('active');
                        this.eyeContactBtn.textContent = '👁️ Eye Contact: ON';
                        this.setStatus('idle', 'Webcam eye-contact locked');
                    } catch (err) {
                        this.setStatus('idle', `Camera: ${err.message}`);
                    }
                }
            });
        }

        // Hands-Free Continuous Talk Header Toggle
        if (this.handsFreeBtn) {
            this.handsFreeBtn.addEventListener('click', () => {
                this.tts.primeAudio();
                const next = !this.stt.handsFreeMode;
                this.stt.setHandsFreeMode(next);
                this.updateHandsFreeUI();
                if (next && this.status === 'idle') {
                    this.startListening();
                } else if (!next && this.status === 'listening') {
                    this.stt.stop();
                    this.setStatus('idle', 'Ready');
                }
            });
        }

        // Brain switcher header toggle
        if (this.brainToggleBtn) {
            this.brainToggleBtn.addEventListener('click', () => {
                const nextProvider = this.aiProvider === 'ollama' ? 'gemini' : 'ollama';
                if (nextProvider === 'gemini' && !this.gemini.apiKey) {
                    this.openSettings(true);
                    return;
                }
                this.setAiProvider(nextProvider);
            });
        }

        // Microphone Button (with human barge-in support: interrupts Miku immediately if she is speaking!)
        this.micBtn.addEventListener('click', () => {
            this.tts.primeAudio();
            if (this.status === 'listening') {
                this.stt.triggerFinalResult();
            } else {
                this.ollama.abortActiveRequest();
                this.startListening();
            }
        });

        // Toggle 3D / 2D View
        if (this.viewModeToggle) {
            this.viewModeToggle.addEventListener('click', () => {
                const nextMode = this.viewMode === '3d' ? '2d' : '3d';
                this.applyViewMode(nextMode);
            });
        }

        // Spacebar push-to-talk (disabled when typing or inside modal popups)
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && document.activeElement !== this.userInput && !this.isModalOpen()) {
                if (this.status !== 'listening') {
                    e.preventDefault();
                    this.ollama.abortActiveRequest();
                    this.tts.primeAudio();
                    this.startListening();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && document.activeElement !== this.userInput && !this.isModalOpen()) {
                if (this.status === 'listening') {
                    e.preventDefault();
                    this.stt.triggerFinalResult();
                }
            }
        });
    }

    bindDialogueActions() {
        if (this.btnReplayVoice) {
            this.btnReplayVoice.addEventListener('click', () => {
                this.tts.primeAudio();
                if (this.lastMikuResponse) {
                    this.speakMikuResponse(this.lastMikuResponse.speechText, this.lastMikuResponse.action);
                } else {
                    const text = this.subtitleText.textContent.trim();
                    if (text) this.speakMikuResponse(text, 'explain');
                }
            });
        }

        if (this.btnSoundCheck) {
            this.btnSoundCheck.addEventListener('click', async () => {
                this.tts.primeAudio();
                const ok = await this.visualizer.playTestChime();
                if (ok) {
                    this.speakMikuResponse("Audio check! Can you hear my voice clearly now?", 'wave');
                } else {
                    this.setStatus('idle', 'Audio blocked—check browser mute or speaker output in Settings');
                }
            });
        }

        if (this.btnCopyReply) {
            this.btnCopyReply.addEventListener('click', () => {
                const textToCopy = this.subtitleText.textContent.trim();
                if (textToCopy) {
                    navigator.clipboard.writeText(textToCopy).then(() => {
                        const original = this.btnCopyReply.textContent;
                        this.btnCopyReply.textContent = '✅ Copied!';
                        setTimeout(() => { this.btnCopyReply.textContent = original; }, 1500);
                    });
                }
            });
        }

        if (this.btnToggleChatLog) {
            this.btnToggleChatLog.addEventListener('click', () => this.openChatHistory());
        }
        if (this.closeChatHistoryBtn) {
            this.closeChatHistoryBtn.addEventListener('click', () => this.closeChatHistory());
        }
        if (this.btnCloseChatHistory) {
            this.btnCloseChatHistory.addEventListener('click', () => this.closeChatHistory());
        }
        if (this.btnClearChatHistory) {
            this.btnClearChatHistory.addEventListener('click', () => {
                this.chatTurns = [];
                this.ollama.clearHistory();
                this.gemini.clearHistory();
                this.renderChatHistory();
            });
        }
        if (this.chatHistoryModal) {
            this.chatHistoryModal.addEventListener('click', (e) => {
                if (e.target === this.chatHistoryModal) this.closeChatHistory();
            });
        }
    }

    openChatHistory() {
        this.renderChatHistory();
        if (this.chatHistoryModal) {
            this.chatHistoryModal.classList.add('active');
        }
    }

    closeChatHistory() {
        if (this.chatHistoryModal) {
            this.chatHistoryModal.classList.remove('active');
        }
    }

    addChatTurn(speaker, text, action = 'idle', speechText = null) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.chatTurns.push({
            speaker,
            text,
            action,
            speechText: speechText || text,
            time: timeStr
        });
        this.renderChatHistory();
    }

    renderChatHistory() {
        if (!this.chatHistoryList) return;
        if (!this.chatTurns.length) {
            this.chatHistoryList.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 24px;">
                    No conversation history yet. Start speaking or typing to Miku!
                </div>
            `;
            return;
        }

        this.chatHistoryList.innerHTML = '';
        this.chatTurns.forEach((turn, idx) => {
            const div = document.createElement('div');
            div.className = `chat-turn ${turn.speaker}`;

            const isMiku = turn.speaker === 'miku';
            const speakerLabel = isMiku ? 'MIKU 🎵' : 'YOU 👤';

            div.innerHTML = `
                <div class="chat-turn-header">
                    <span>${speakerLabel}</span>
                    <span class="chat-turn-time">${turn.time}</span>
                </div>
                <div class="chat-turn-body"></div>
                ${isMiku ? `
                    <div class="chat-turn-actions">
                        <button class="dialogue-action-btn btn-turn-speak" data-idx="${idx}" style="font-size: 10px; padding: 2px 7px;">🔊 Speak</button>
                        <button class="dialogue-action-btn btn-turn-copy" data-idx="${idx}" style="font-size: 10px; padding: 2px 7px;">📋 Copy</button>
                    </div>
                ` : ''}
            `;
            div.querySelector('.chat-turn-body').textContent = turn.text;
            this.chatHistoryList.appendChild(div);
        });

        const speakBtns = this.chatHistoryList.querySelectorAll('.btn-turn-speak');
        speakBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx, 10);
                const turn = this.chatTurns[idx];
                if (turn) {
                    this.tts.primeAudio();
                    this.executeMotion(turn.action || 'explain');
                    this.speakMikuResponse(turn.speechText || turn.text, turn.action || 'explain');
                }
            });
        });

        const copyBtns = this.chatHistoryList.querySelectorAll('.btn-turn-copy');
        copyBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx, 10);
                const turn = this.chatTurns[idx];
                if (turn) {
                    navigator.clipboard.writeText(turn.text);
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
                }
            });
        });

        this.chatHistoryList.scrollTop = this.chatHistoryList.scrollHeight;
    }

    startListening() {
        this.tts.stop();
        this.setStatus('listening', 'Listening to you...');
        this.showSubtitle("You", "Listening... (Speak naturally)", 'neutral');
        this.executeMotion('listen');

        this.stt.start(
            (finalText) => {
                if (finalText && finalText.trim()) {
                    this.userInput.value = finalText.trim();
                    this.tts.primeAudio();
                    this.handleUserSubmit();
                } else {
                    this.setStatus('idle', 'Ready');
                    this.miku3D.resetToIdle();
                }
            },
            (interimText) => {
                this.showSubtitle("You", interimText, 'neutral');
                this.visualizer.setSimulatedVolume(0.45 + Math.random() * 0.4);
            },
            () => { this.setStatus('listening', 'Miku is listening...'); },
            () => {
                if (this.status === 'listening') {
                    this.setStatus('idle', 'Ready');
                    this.miku3D.resetToIdle();
                }
                this.visualizer.setSimulatedVolume(0);
            },
            (err) => {
                this.setStatus('idle', `Mic: ${err}`);
                this.miku3D.resetToIdle();
            }
        );
    }

    _onSpeechFinished() {
        this.miku3D.setMouthOpenness(0);
        this.avatar2D.setMouthOpenness(0);
        this.visualizer.setSimulatedVolume(0);
        this.setStatus('idle', 'Ready to chat');
        if (this.btnReplayVoice) {
            this.btnReplayVoice.textContent = '🔊 Replay Voice';
        }
        if (this.viewMode === '3d') {
            this.miku3D.resetToIdle();
        }
        // Hands-Free Continuous Talk: automatically re-open mic 420ms after Miku finishes speaking!
        if (this.stt.handsFreeMode && !this.isModalOpen()) {
            setTimeout(() => {
                if (this.status === 'idle' && this.stt.handsFreeMode && !this.isModalOpen()) {
                    this.startListening();
                }
            }, 420);
        }
    }

    async handleUserSubmit() {
        const text = this.userInput.value.trim();
        if (!text) return;

        this.userInput.value = '';
        this.lastUserActivityAt = Date.now();
        clearTimeout(this.typingIdleTimer);

        // Human Barge-In: cancel any previous overlapping speech or generation immediately
        this.ollama.abortActiveRequest();
        this.tts.stop();
        this.stt.stop();

        // Extract & persist personal episodic memory BEFORE sending to brain!
        this.memory.observeUserMessage(text);
        this.syncMemoryToBrains();
        this.renderMemoryBank();

        // 1. Display user prompt context ribbon
        if (this.dialogueUserPrompt && this.dialogueUserText) {
            this.dialogueUserPrompt.style.display = 'flex';
            this.dialogueUserText.textContent = text;
        }

        // 2. Record user turn in transcript
        this.addChatTurn('user', text);

        // 2.5 INSTANT PC CONTROL & SAVED COMMAND ENGINE (<15ms execution + auto-save—zero LLM wait!)
        const fastPcHit = await this.callPcApi('/api/pc/resolve', 'POST', {
            text,
            only_saved: false,
            execute: true
        });
        if (fastPcHit && fastPcHit.matched) {
            const dynamicTools = new Set(['pc_status', 'screenshot', 'web_search', 'window_control']);
            const replyText = (dynamicTools.has(fastPcHit.tool) && fastPcHit.result?.reply)
                ? fastPcHit.result.reply
                : (fastPcHit.reply || fastPcHit.result?.reply || 'Done!');
            const act = fastPcHit.result?.action || 'nod';
            this.ollama.history.push({ role: 'user', content: text });
            this.ollama.history.push({ role: 'assistant', content: replyText });
            const badgeLabel = fastPcHit.source === 'saved_cache'
                ? `⚡ ${fastPcHit.latencyMs}ms Saved Command (${fastPcHit.hits}x)`
                : `⚡ ${fastPcHit.latencyMs}ms Live PC Control (Saved!)`;
            this.updateLatencyPill(badgeLabel, true);
            this.handleMikuResponse({
                action: act,
                rawText: replyText,
                speechText: replyText
            });
            return;
        }

        const isOllama = this.aiProvider === 'ollama';
        const providerName = isOllama
            ? `Local Ollama (${this.ollama.model})`
            : `Gemini (${this.gemini.model})`;
        const providerShort = isOllama ? this.ollama.model : 'Gemini';

        this.setStatus('thinking', `Miku is thinking via ${providerName}...`);
        if (isOllama && this.viewMode === '3d') {
            this.miku3D.setInferenceThrottle(true);
        }

        // 3. Instant (<40ms) Pre-Verbal Human Reaction (inspiratory breath + eyebrow flash / cognitive gaze shift!)
        const userIntent = this.ollama.detectUserIntent(text);
        if (this.viewMode === '3d') {
            this.miku3D.preSpeechReaction(userIntent);
        } else {
            this.executeMotion('think');
        }

        const thinkingTimeout = setTimeout(() => {
            if (this.status === 'thinking') {
                this.showSubtitleHtml("Miku", `
                    <div class="thinking-wave">
                        <span>Thinking (${escapeHtml(providerShort)})</span>
                        <span class="thinking-dots">
                            <span class="thinking-dot"></span>
                            <span class="thinking-dot"></span>
                            <span class="thinking-dot"></span>
                        </span>
                    </div>
                `);
            }
        }, 140);

        try {
            const aiClient = this.getAiClient();
            let actionFired = false;

            if (isOllama) {
                const useStreamingVoice = this.ollama.turboMode;
                let clausesEnqueued = 0;
                let streamedCommand = null;
                let streamedExecPromise = null;

                if (useStreamingVoice) {
                    this.tts.beginStreamSession({
                        onPhoneme: (openness, viseme) => {
                            this.miku3D.setMouthOpenness(openness, viseme);
                            this.avatar2D.setMouthOpenness(openness);
                            this.visualizer.setSimulatedVolume(openness);
                        },
                        onClauseAction: (clauseAction) => {
                            if (clauseAction) this.executeMotion(clauseAction);
                        },
                        onStart: (voiceName) => {
                            this.setStatus('speaking', `Speaking (${voiceName})`);
                            if (this.btnReplayVoice) {
                                this.btnReplayVoice.classList.remove('pulse-glow');
                                this.btnReplayVoice.textContent = '🔊 Speaking...';
                            }
                        },
                        onEnd: () => this._onSpeechFinished(),
                        onError: (errCode) => {
                            console.warn("[TTS] Voice output notice:", errCode);
                            if (this.btnReplayVoice) {
                                this.btnReplayVoice.textContent = '🔊 Click to Speak Voice';
                                this.btnReplayVoice.classList.add('pulse-glow');
                            }
                        }
                    });
                }

                const result = await aiClient.sendMessageStream(
                    text,
                    (chunk) => {
                        clearTimeout(thinkingTimeout);
                        if (!actionFired && chunk.action && chunk.action !== 'idle') {
                            actionFired = true;
                            this.executeMotion(chunk.action);
                        }
                        if (chunk.ttftMs) {
                            this.updateLatencyPill(`⚡ ${(chunk.ttftMs / 1000).toFixed(2)}s first token`, true);
                        }
                        this.showSubtitleHtml("Miku", `${escapeHtml(chunk.partialText)}<span class="streaming-cursor"></span>`);
                    },
                    (detectedAction) => {
                        if (!actionFired && detectedAction) {
                            actionFired = true;
                            this.executeMotion(detectedAction);
                        }
                    },
                    useStreamingVoice ? (clause) => {
                        clausesEnqueued++;
                        this.tts.enqueueClause(clause.speechText, clause.action);
                    } : null,
                    (cmd) => {
                        // Ollama emitted <<CMD:tool|target>> -> execute PC/Browser action immediately mid-stream!
                        streamedCommand = cmd;
                        streamedExecPromise = this.callPcApi('/api/pc/execute', 'POST', {
                            tool: cmd.tool,
                            target: cmd.target,
                            execute: true,
                            save: false
                        });
                    }
                );

                clearTimeout(thinkingTimeout);
                this.miku3D.setInferenceThrottle(false);
                if (!result) return;

                // Finalize Conversational Ollama PC Command(s) & Save to Instant Cache!
                const allCmds = (result.commands && result.commands.length > 0)
                    ? result.commands
                    : (streamedCommand ? [streamedCommand] : []);
                if (allCmds.length > 0) {
                    const firstCmd = allCmds[0];
                    let execRes = null;
                    if (allCmds.length === 1 && streamedExecPromise) {
                        execRes = await streamedExecPromise;
                    } else {
                        const remainingSteps = streamedExecPromise ? allCmds.slice(1) : allCmds;
                        if (streamedExecPromise) await streamedExecPromise;
                        if (remainingSteps.length > 0) {
                            execRes = await this.callPcApi('/api/pc/execute', 'POST', {
                                tool: remainingSteps[0].tool,
                                target: remainingSteps[0].target,
                                steps: remainingSteps,
                                execute: true,
                                save: false
                            });
                        }
                    }
                    if (execRes && (firstCmd.tool === 'pc_status' || firstCmd.tool === 'screenshot') && execRes.reply) {
                        result.rawText = execRes.reply;
                        result.speechText = execRes.reply;
                        if (useStreamingVoice) {
                            this.tts.enqueueClause(execRes.reply, execRes.action || 'explain');
                            clausesEnqueued++;
                        }
                    }
                    await this.callPcApi('/api/pc/execute', 'POST', {
                        tool: firstCmd.tool,
                        target: firstCmd.target,
                        steps: allCmds,
                        phrase: text,
                        reply: result.rawText,
                        execute: false,
                        save: true
                    });
                    if (result.metrics) {
                        this.updateLatencyPill(`⚡ Ollama PC Action Saved • ${(result.metrics.ttftMs / 1000).toFixed(2)}s TTFT`, true);
                    }
                } else if (result.metrics) {
                    this.updateLatencyPill(`⚡ ${(result.metrics.ttftMs / 1000).toFixed(2)}s TTFT • ${result.metrics.tokensPerSec} tok/s`, true);
                }

                if (useStreamingVoice && clausesEnqueued > 0) {
                    this.lastMikuResponse = result;
                    this.showSubtitle("Miku", result.rawText, result.action);
                    this.addChatTurn('miku', result.rawText, result.action, result.speechText);
                    this.tts.endStreamSession();
                } else {
                    this.handleMikuResponse(result);
                }
            } else {
                const result = await aiClient.sendMessage(text);
                clearTimeout(thinkingTimeout);
                this.handleMikuResponse(result);
            }
        } catch (err) {
            clearTimeout(thinkingTimeout);
            this.miku3D.setInferenceThrottle(false);
            if (err.name === 'AbortError') {
                return;
            }
            console.error("AI Generation Error:", err);
            this.setStatus('idle', 'Error occurred');

            let helpfulAdvice = err.message;
            if (isOllama && err.message.includes('Cannot connect')) {
                helpfulAdvice = `Could not connect to Ollama at ${this.ollama.host}. Is Ollama running in background? (Start 'ollama serve' or open Ollama app).`;
            }

            this.showSubtitle("Miku", `Oops! ${helpfulAdvice}`, 'crying');
            this.executeMotion('empathy');
        }
    }

    handleMikuResponse(response) {
        const { action, rawText, speechText } = response;
        this.lastMikuResponse = response;

        this.showSubtitle("Miku", rawText, action);
        this.addChatTurn('miku', rawText, action, speechText);
        this.speakMikuResponse(speechText, action);
    }

    speakMikuResponse(speechText, action = 'explain') {
        this.setStatus('speaking', `Miku is speaking [${action}]`);
        this.executeMotion(action);

        if (this.btnReplayVoice) {
            this.btnReplayVoice.classList.remove('pulse-glow');
            this.btnReplayVoice.textContent = '🔊 Speaking...';
        }

        this.tts.speak(
            speechText,
            (openness, viseme) => {
                this.miku3D.setMouthOpenness(openness, viseme);
                this.avatar2D.setMouthOpenness(openness);
                this.visualizer.setSimulatedVolume(openness);
            },
            (voiceName) => {
                this.setStatus('speaking', `Speaking (${voiceName})`);
            },
            () => this._onSpeechFinished(),
            (errCode) => {
                console.warn("[TTS] Voice output notice:", errCode);
                if (this.btnReplayVoice) {
                    this.btnReplayVoice.textContent = '🔊 Click to Speak Voice';
                    this.btnReplayVoice.classList.add('pulse-glow');
                }
            },
            action
        );
    }

    showSubtitle(speaker, text) {
        this.dialogueCard.classList.remove('hidden');
        this.speakerName.textContent = speaker;
        this.speakerName.className = `speaker-label ${speaker.toLowerCase()}`;
        this.subtitleText.textContent = text;

        if (window.gsap) {
            gsap.fromTo(this.dialogueCard, { y: 4, opacity: 0.92 }, { y: 0, opacity: 1, duration: 0.22, ease: "power2.out" });
        }
    }

    showSubtitleHtml(speaker, htmlContent) {
        this.dialogueCard.classList.remove('hidden');
        this.speakerName.textContent = speaker;
        this.speakerName.className = `speaker-label ${speaker.toLowerCase()}`;
        this.subtitleText.innerHTML = htmlContent;
    }

    bindMotionControls() {
        const motionBtns = document.querySelectorAll('.motion-btn');
        motionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.lastUserActivityAt = Date.now();
                const action = btn.dataset.action;
                this.executeMotion(action);
                motionBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (window.gsap) {
                    gsap.fromTo(btn, { scale: 0.93 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
                }
            });
        });
    }

    bindSettings() {
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) this.closeSettings();
        });

        const providerSelect = document.getElementById('cfg-ai-provider');
        const ollamaSection = document.getElementById('section-ollama-settings');
        const geminiSection = document.getElementById('section-gemini-settings');

        const ollamaHostInput = document.getElementById('cfg-ollama-host');
        const ollamaModelSelect = document.getElementById('cfg-ollama-model');
        const ollamaCustomInput = document.getElementById('cfg-ollama-custom-model');
        const ollamaTurboCheck = document.getElementById('cfg-ollama-turbo');
        const ollamaThreadsSelect = document.getElementById('cfg-ollama-threads');
        const btnDetectOllama = document.getElementById('btn-detect-ollama');
        const ollamaDetectStatus = document.getElementById('ollama-detect-status');
        const btnTestOllama = document.getElementById('btn-test-ollama');
        const ollamaDiagPanel = document.getElementById('ollama-diagnostics-panel');

        const apiKeyInput = document.getElementById('cfg-api-key');
        const modelSelect = document.getElementById('cfg-model');
        const customModelInput = document.getElementById('cfg-custom-model');
        const detectBtn = document.getElementById('btn-detect-models');
        const detectStatus = document.getElementById('model-detect-status');
        const diagBtn = document.getElementById('btn-run-diagnostics');
        const diagPanel = document.getElementById('diagnostics-panel');

        const ttsModeSelect = document.getElementById('cfg-tts-mode');
        const audioSinkSelect = document.getElementById('cfg-audio-sink');
        const btnRefreshSinks = document.getElementById('btn-refresh-sinks');
        const volSlider = document.getElementById('cfg-tts-volume');
        const volVal = document.getElementById('cfg-vol-val');
        const handsFreeCheck = document.getElementById('cfg-hands-free');
        const langSelect = document.getElementById('cfg-stt-lang');
        const voiceSelect = document.getElementById('cfg-tts-voice');
        const pitchSlider = document.getElementById('cfg-tts-pitch');
        const rateSlider = document.getElementById('cfg-tts-rate');
        const pitchVal = document.getElementById('cfg-pitch-val');
        const rateVal = document.getElementById('cfg-rate-val');
        const btnClearMemory = document.getElementById('btn-clear-memory');

        const testVoiceBtn = document.getElementById('btn-test-voice');
        const saveBtn = document.getElementById('btn-save-settings');

        if (providerSelect) {
            providerSelect.value = this.aiProvider;
            const updateProviderSections = () => {
                const isOllama = providerSelect.value === 'ollama';
                if (ollamaSection) ollamaSection.style.display = isOllama ? 'block' : 'none';
                if (geminiSection) geminiSection.style.display = isOllama ? 'none' : 'block';
            };
            updateProviderSections();
            providerSelect.addEventListener('change', updateProviderSections);
        }

        if (ollamaHostInput) ollamaHostInput.value = this.ollama.host;
        if (ollamaTurboCheck) ollamaTurboCheck.checked = this.ollama.turboMode;
        if (ollamaThreadsSelect) ollamaThreadsSelect.value = String(this.ollama.cpuThreads);
        if (ttsModeSelect) ttsModeSelect.value = this.tts.engineMode;
        if (volSlider && volVal) {
            volSlider.value = this.visualizer.volumeBoost;
            volVal.textContent = `${Math.round(this.visualizer.volumeBoost * 100)}%`;
        }
        if (handsFreeCheck) handsFreeCheck.checked = this.stt.handsFreeMode;

        if (btnClearMemory) {
            btnClearMemory.addEventListener('click', () => {
                this.memory.clear();
                this.syncMemoryToBrains();
                this.renderMemoryBank();
            });
        }

        if (ollamaModelSelect) {
            const ollamaOpts = Array.from(ollamaModelSelect.options).map(o => o.value);
            if (ollamaOpts.includes(this.ollama.model)) {
                ollamaModelSelect.value = this.ollama.model;
                if (ollamaCustomInput) ollamaCustomInput.style.display = 'none';
            } else {
                ollamaModelSelect.value = 'custom';
                if (ollamaCustomInput) {
                    ollamaCustomInput.value = this.ollama.model;
                    ollamaCustomInput.style.display = 'block';
                }
            }

            ollamaModelSelect.addEventListener('change', () => {
                if (ollamaCustomInput) {
                    ollamaCustomInput.style.display = ollamaModelSelect.value === 'custom' ? 'block' : 'none';
                    if (ollamaModelSelect.value === 'custom') ollamaCustomInput.focus();
                }
            });
        }

        if (btnDetectOllama) {
            btnDetectOllama.addEventListener('click', async () => {
                const host = (ollamaHostInput?.value || this.ollama.host).trim();
                this.ollama.setHost(host);

                if (ollamaDetectStatus) {
                    ollamaDetectStatus.style.display = 'block';
                    ollamaDetectStatus.style.color = 'var(--miku-teal)';
                    ollamaDetectStatus.textContent = '🔄 Fetching local models from Ollama...';
                }
                btnDetectOllama.disabled = true;

                try {
                    const models = await this.ollama.listAvailableModels();
                    if (models && models.length > 0) {
                        ollamaModelSelect.innerHTML = '';
                        models.filter(m => !m.endsWith('-base')).forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m;
                            opt.textContent = m === 'miku-human:latest'
                                ? `${m} (Compiled Human Persona - Fastest)`
                                : (m === 'nchapman/dolphin3.0-qwen2.5:3b' ? `${m} (Base Qwen 2.5 3B)` : m);
                            ollamaModelSelect.appendChild(opt);
                        });

                        const customOpt = document.createElement('option');
                        customOpt.value = 'custom';
                        customOpt.textContent = 'Custom Model Name...';
                        ollamaModelSelect.appendChild(customOpt);

                        if (models.includes(this.ollama.model)) {
                            ollamaModelSelect.value = this.ollama.model;
                        } else {
                            ollamaModelSelect.value = models[0];
                        }

                        if (ollamaDetectStatus) {
                            ollamaDetectStatus.textContent = `✅ Successfully found ${models.length} local models in Ollama!`;
                            ollamaDetectStatus.style.color = '#00f3ff';
                        }
                    } else {
                        if (ollamaDetectStatus) {
                            ollamaDetectStatus.textContent = '⚠️ No models found or Ollama is not responding. Run "ollama serve" in terminal.';
                            ollamaDetectStatus.style.color = '#ffaa44';
                        }
                    }
                } catch (e) {
                    if (ollamaDetectStatus) {
                        ollamaDetectStatus.textContent = `❌ Ollama error: ${e.message}`;
                        ollamaDetectStatus.style.color = '#ff6b6b';
                    }
                } finally {
                    btnDetectOllama.disabled = false;
                }
            });
        }

        if (btnTestOllama) {
            btnTestOllama.addEventListener('click', async () => {
                const host = (ollamaHostInput?.value || this.ollama.host).trim();
                const chosenModel = (ollamaModelSelect.value === 'custom' && ollamaCustomInput && ollamaCustomInput.value.trim())
                    ? ollamaCustomInput.value.trim()
                    : ollamaModelSelect.value;

                this.ollama.setHost(host);
                this.ollama.setModel(chosenModel);
                if (ollamaThreadsSelect) this.ollama.setCpuThreads(ollamaThreadsSelect.value);

                if (ollamaDiagPanel) {
                    ollamaDiagPanel.style.display = 'block';
                    ollamaDiagPanel.innerHTML = '<span style="color:var(--miku-cyan)">⏳ Benchmarking & warming local neural core...</span>';
                }
                btnTestOllama.disabled = true;

                try {
                    const diag = await this.ollama.runDiagnostics();
                    if (ollamaDiagPanel) {
                        if (diag.success) {
                            ollamaDiagPanel.innerHTML = `
                                <div style="color:#00f3ff; margin-bottom:3px;">✅ <strong>Local Neural Core Online & Pre-Warmed!</strong></div>
                                <div>• Host: <code>${diag.host}</code></div>
                                <div>• Active Model: <strong>${diag.model}</strong></div>
                                <div>• Warm Latency: <strong>${diag.latencyMs}ms</strong> ${diag.tokensPerSec ? `(${diag.tokensPerSec} tok/s)` : ''}</div>
                                <div style="color:#39c5bb; margin-top:4px;">✨ Pinned in RAM (30m keep-alive) & ready for instant voice talk-back!</div>
                            `;
                            this.updateLatencyPill('⚡ Instant Warm Ready', true);
                        } else {
                            ollamaDiagPanel.innerHTML = `
                                <div style="color:#ff6b6b; margin-bottom:3px;">❌ <strong>Ollama Offline or Error:</strong></div>
                                <div>${escapeHtml(diag.error)}</div>
                                <div style="color:#ffaa44; margin-top:4px;">💡 Tip: Open terminal and type <code>ollama serve</code> or launch the Ollama app.</div>
                            `;
                        }
                    }
                } catch (e) {
                    if (ollamaDiagPanel) {
                        ollamaDiagPanel.innerHTML = `<span style="color:#ff6b6b">❌ Diagnostic error: ${escapeHtml(e.message)}</span>`;
                    }
                } finally {
                    btnTestOllama.disabled = false;
                }
            });
        }

        if (apiKeyInput) apiKeyInput.value = this.gemini.apiKey;
        if (modelSelect) {
            const existingOptions = Array.from(modelSelect.options).map(o => o.value);
            if (existingOptions.includes(this.gemini.model)) {
                modelSelect.value = this.gemini.model;
                if (customModelInput) customModelInput.style.display = 'none';
            } else {
                modelSelect.value = 'custom';
                if (customModelInput) {
                    customModelInput.value = this.gemini.model;
                    customModelInput.style.display = 'block';
                }
            }

            modelSelect.addEventListener('change', () => {
                if (customModelInput) {
                    customModelInput.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
                    if (modelSelect.value === 'custom') customModelInput.focus();
                }
            });
        }

        if (detectBtn) {
            detectBtn.addEventListener('click', async () => {
                const key = (apiKeyInput.value || '').trim() || this.gemini.apiKey;
                if (!key) {
                    if (detectStatus) {
                        detectStatus.style.display = 'block';
                        detectStatus.textContent = '⚠️ Please enter an API key first.';
                        detectStatus.style.color = '#ffaa44';
                    }
                    apiKeyInput.focus();
                    return;
                }

                if (detectStatus) {
                    detectStatus.style.display = 'block';
                    detectStatus.style.color = 'var(--miku-teal)';
                    detectStatus.textContent = '🔄 Querying active models from Google AI Studio...';
                }
                detectBtn.disabled = true;

                try {
                    this.gemini.setApiKey(key);
                    const models = await this.gemini.listAvailableModels();
                    if (models && models.length > 0) {
                        modelSelect.innerHTML = '';
                        const topModels = ['gemini-3.8-flash', 'gemini-3.8-pro'];
                        topModels.forEach(tm => {
                            if (!models.includes(tm)) models.unshift(tm);
                        });

                        models.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m;
                            opt.textContent = m === 'gemini-3.8-flash'
                                ? `${m} (Active Production - Recommended)`
                                : (m === 'gemini-3.8-pro' ? `${m} (Flagship Reasoning)` : m);
                            modelSelect.appendChild(opt);
                        });

                        const customOpt = document.createElement('option');
                        customOpt.value = 'custom';
                        customOpt.textContent = 'Custom Model ID...';
                        modelSelect.appendChild(customOpt);

                        modelSelect.value = models.includes(this.gemini.model) ? this.gemini.model : models[0];
                        if (customModelInput) {
                            customModelInput.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
                        }

                        if (detectStatus) {
                            detectStatus.textContent = `✅ Successfully loaded ${models.length} active models for your key!`;
                            detectStatus.style.color = '#00f3ff';
                        }
                    } else {
                        if (detectStatus) {
                            detectStatus.textContent = '⚠️ No models returned. Check key permissions or network.';
                            detectStatus.style.color = '#ffaa44';
                        }
                    }
                } catch (e) {
                    if (detectStatus) {
                        detectStatus.textContent = `❌ Error: ${e.message}`;
                        detectStatus.style.color = '#ff6b6b';
                    }
                } finally {
                    detectBtn.disabled = false;
                }
            });
        }

        if (diagBtn) {
            diagBtn.addEventListener('click', async () => {
                const key = (apiKeyInput.value || '').trim() || this.gemini.apiKey;
                if (!key) {
                    if (diagPanel) {
                        diagPanel.style.display = 'block';
                        diagPanel.innerHTML = '<span style="color:#ff6b6b">⚠️ Please enter your Gemini API key above first!</span>';
                    }
                    apiKeyInput.focus();
                    return;
                }

                if (diagPanel) {
                    diagPanel.style.display = 'block';
                    diagPanel.innerHTML = '<span style="color:var(--miku-cyan)">⏳ Running live diagnostics against Google AI Studio servers...</span>';
                }
                diagBtn.disabled = true;

                try {
                    const diag = await this.gemini.runDiagnostics(key);
                    if (diagPanel) {
                        const html = diag.logs.map(log => {
                            if (log.startsWith('✅')) return `<div style="color:#00f3ff; margin-bottom:2px;">${log}</div>`;
                            if (log.startsWith('⚠️')) return `<div style="color:#ffaa44; margin-bottom:2px;">${log}</div>`;
                            return `<div style="color:#ff6b6b; margin-bottom:2px;">${log}</div>`;
                        }).join('');

                        let summary = '';
                        if (diag.recommendedModel) {
                            summary = `<div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(255,255,255,0.2); color:#39c5bb;"><strong>Recommended Active Model:</strong> ${diag.recommendedModel}</div>`;
                            modelSelect.value = diag.recommendedModel;
                            this.gemini.setModel(diag.recommendedModel);
                        }

                        diagPanel.innerHTML = html + summary;
                    }
                } catch (e) {
                    if (diagPanel) {
                        diagPanel.innerHTML = `<span style="color:#ff6b6b">❌ Diagnostic error: ${e.message}</span>`;
                    }
                } finally {
                    diagBtn.disabled = false;
                }
            });
        }

        langSelect.value = this.stt.language;
        pitchSlider.value = this.tts.pitch;
        rateSlider.value = this.tts.rate;
        pitchVal.textContent = this.tts.pitch;
        rateVal.textContent = this.tts.rate;
        if (volSlider && volVal) {
            volSlider.value = this.visualizer.volumeBoost;
            volVal.textContent = `${Math.round(this.visualizer.volumeBoost * 100)}%`;
            volSlider.addEventListener('input', () => {
                volVal.textContent = `${Math.round(parseFloat(volSlider.value) * 100)}%`;
                this.visualizer.setVolumeBoost(volSlider.value);
            });
        }

        const populateAudioSinks = async (requestLabels = false) => {
            if (!audioSinkSelect) return;
            try {
                if (requestLabels && navigator.mediaDevices?.getUserMedia) {
                    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tmp.getTracks().forEach(t => t.stop());
                }
            } catch (e) {}
            const sinks = await this.visualizer.listOutputDevices();
            audioSinkSelect.innerHTML = '<option value="">System Default Speaker / Headphones</option>';
            sinks.forEach((d, idx) => {
                if (d.deviceId === 'default') return;
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `Speaker Output #${idx + 1}`;
                if (d.deviceId === this.visualizer.sinkId) opt.selected = true;
                audioSinkSelect.appendChild(opt);
            });
        };
        this._populateAudioSinks = populateAudioSinks;
        populateAudioSinks(false);

        if (btnRefreshSinks) {
            btnRefreshSinks.addEventListener('click', () => populateAudioSinks(true));
        }
        if (audioSinkSelect) {
            audioSinkSelect.addEventListener('change', async () => {
                await this.visualizer.setOutputDevice(audioSinkSelect.value);
                await this.visualizer.playTestChime();
            });
        }

        const populateVoices = () => {
            const voices = this.tts.getVoices();
            voiceSelect.innerHTML = '<option value="">Auto-Detect per Language (Recommended)</option>';
            voices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.voiceURI;
                opt.textContent = `${v.name} (${v.lang})`;
                if (v.voiceURI === this.tts.selectedVoiceURI) opt.selected = true;
                voiceSelect.appendChild(opt);
            });
        };
        populateVoices();
        if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = populateVoices;
        }

        pitchSlider.addEventListener('input', () => { pitchVal.textContent = pitchSlider.value; });
        rateSlider.addEventListener('input', () => { rateVal.textContent = rateSlider.value; });

        testVoiceBtn.addEventListener('click', async () => {
            this.tts.primeAudio();
            if (ttsModeSelect) this.tts.setEngineMode(ttsModeSelect.value);
            if (volSlider) this.visualizer.setVolumeBoost(volSlider.value);
            if (audioSinkSelect) await this.visualizer.setOutputDevice(audioSinkSelect.value);
            this.tts.setPitch(pitchSlider.value);
            this.tts.setRate(rateSlider.value);
            this.tts.setVoice(voiceSelect.value);
            await this.visualizer.playTestChime();

            this.executeMotion('explain');
            this.tts.speak(
                "Hey there! Look how naturally my lips, hands, and expressions move in sync with my real voice!",
                (openness, viseme) => {
                    this.miku3D.setMouthOpenness(openness, viseme);
                    this.visualizer.setSimulatedVolume(openness);
                },
                (voiceName) => { this.setStatus('speaking', `Testing Voice (${voiceName})...`); },
                () => {
                    this.miku3D.setMouthOpenness(0);
                    this.visualizer.setSimulatedVolume(0);
                    this.setStatus('idle', 'Ready');
                    this.miku3D.resetToIdle();
                },
                null,
                'explain'
            );
        });

        saveBtn.addEventListener('click', () => {
            const selectedProvider = providerSelect ? providerSelect.value : 'ollama';
            this.aiProvider = selectedProvider;
            localStorage.setItem('ai_provider', selectedProvider);
            this.updateBrainToggleUI();

            if (ollamaHostInput) this.ollama.setHost(ollamaHostInput.value.trim());
            const chosenOllamaModel = (ollamaModelSelect.value === 'custom' && ollamaCustomInput && ollamaCustomInput.value.trim())
                ? ollamaCustomInput.value.trim()
                : ollamaModelSelect.value;
            this.ollama.setModel(chosenOllamaModel);
            if (ollamaTurboCheck) this.ollama.setTurboMode(ollamaTurboCheck.checked);
            if (ollamaThreadsSelect) this.ollama.setCpuThreads(ollamaThreadsSelect.value);

            const chosenGeminiModel = (modelSelect.value === 'custom' && customModelInput && customModelInput.value.trim())
                ? customModelInput.value.trim()
                : modelSelect.value;
            this.gemini.setApiKey(apiKeyInput.value.trim());
            this.gemini.setModel(chosenGeminiModel);

            if (ttsModeSelect) this.tts.setEngineMode(ttsModeSelect.value);
            if (volSlider) this.visualizer.setVolumeBoost(volSlider.value);
            if (audioSinkSelect) this.visualizer.setOutputDevice(audioSinkSelect.value);
            if (handsFreeCheck) {
                this.stt.setHandsFreeMode(handsFreeCheck.checked);
                this.updateHandsFreeUI();
            }
            this.stt.setLanguage(langSelect.value);
            this.tts.setVoice(voiceSelect.value);
            this.tts.setPitch(pitchSlider.value);
            this.tts.setRate(rateSlider.value);

            this.closeSettings();

            if (selectedProvider === 'ollama') {
                this.setStatus('idle', `Ollama: ${chosenOllamaModel}`);
                this.showSubtitle("Miku", `All set! Running local AI (${chosenOllamaModel}) in low-latency mode!`, 'happy');
                if (this.ollama.turboMode) {
                    this.updateLatencyPill('⚡ Warming Neural Core...');
                    this.ollama.warmUpModel().then((ok) => {
                        if (ok) this.updateLatencyPill('⚡ Instant Warm Ready', true);
                    });
                }
            } else {
                this.setStatus('idle', `Gemini: ${chosenGeminiModel}`);
                this.showSubtitle("Miku", `Settings saved! Active model: ${chosenGeminiModel}.`, 'happy');
            }
            this.executeMotion('nod');
        });
    }

    openSettings(highlightKey = false) {
        this.renderMemoryBank();
        if (this._populateAudioSinks) this._populateAudioSinks(false);
        this.settingsModal.classList.add('active');
        const providerSelect = document.getElementById('cfg-ai-provider');
        const ollamaHostInput = document.getElementById('cfg-ollama-host');
        const ollamaModelSelect = document.getElementById('cfg-ollama-model');
        const ollamaTurboCheck = document.getElementById('cfg-ollama-turbo');
        const ollamaThreadsSelect = document.getElementById('cfg-ollama-threads');
        const ttsModeSelect = document.getElementById('cfg-tts-mode');
        const audioSinkSelect = document.getElementById('cfg-audio-sink');
        const btnRefreshSinks = document.getElementById('btn-refresh-sinks');
        const volSlider = document.getElementById('cfg-tts-volume');
        const volVal = document.getElementById('cfg-vol-val');
        const handsFreeCheck = document.getElementById('cfg-hands-free');
        const apiKeyInput = document.getElementById('cfg-api-key');

        if (providerSelect) providerSelect.value = this.aiProvider;
        if (ollamaHostInput) ollamaHostInput.value = this.ollama.host;
        if (ollamaTurboCheck) ollamaTurboCheck.checked = this.ollama.turboMode;
        if (ollamaThreadsSelect) ollamaThreadsSelect.value = String(this.ollama.cpuThreads);
        if (ttsModeSelect) ttsModeSelect.value = this.tts.engineMode;
        if (volSlider && volVal) {
            volSlider.value = this.visualizer.volumeBoost;
            volVal.textContent = `${Math.round(this.visualizer.volumeBoost * 100)}%`;
        }
        if (handsFreeCheck) handsFreeCheck.checked = this.stt.handsFreeMode;

        if (ollamaModelSelect) {
            const opts = Array.from(ollamaModelSelect.options).map(o => o.value);
            if (opts.includes(this.ollama.model)) {
                ollamaModelSelect.value = this.ollama.model;
            }
        }
        if (apiKeyInput) apiKeyInput.value = this.gemini.apiKey;

        if (highlightKey && apiKeyInput && this.aiProvider === 'gemini') {
            apiKeyInput.focus();
        }
    }

    closeSettings() {
        this.settingsModal.classList.remove('active');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.mikuApp = new MikuApp();
});
