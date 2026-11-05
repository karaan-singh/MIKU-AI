import { GeminiClient } from './gemini.js?v=20261105b';
import { OllamaClient } from './ollama.js?v=20261105b';
import { TTSEngine } from './tts.js?v=20261105b';
import { STTEngine } from './stt.js?v=20261105b';
import { Miku3D } from './miku3d.js?v=20261105b';
import { AvatarEngine } from './avatar.js?v=20261105b';
import { AudioVisualizer } from './audio.js?v=20261105b';

class MikuApp {
    constructor() {
        this.status = 'idle';
        this.viewMode = localStorage.getItem('miku_view_mode') || '3d'; // '3d' or '2d'

        // AI Provider: default to 'ollama' for 100% offline local AI!
        this.aiProvider = localStorage.getItem('ai_provider') || 'ollama';
        this.ollama = new OllamaClient();
        this.ollama.clearHistory();
        this.gemini = new GeminiClient();

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

        this.tts = new TTSEngine();
        this.stt = new STTEngine();

        // 3D Animated Character Container
        this.container3D = document.getElementById('avatar-3d-container');
        this.miku3D = new Miku3D(this.container3D);

        // 2D Illustrated Mode Container
        this.container2D = document.getElementById('avatar-2d-container');
        this.avatar2D = new AvatarEngine(this.container2D);

        // Visualizer
        this.vizCanvas = document.getElementById('audio-visualizer-canvas');
        this.visualizer = new AudioVisualizer(this.vizCanvas);

        // UI Elements
        this.statusBadge = document.getElementById('status-badge');
        this.statusText = document.getElementById('status-text');
        this.dialogueCard = document.getElementById('dialogue-card');
        this.speakerName = document.getElementById('speaker-name');
        this.subtitleText = document.getElementById('subtitle-text');
        this.userInput = document.getElementById('user-text-input');
        this.sendBtn = document.getElementById('send-btn');
        this.micBtn = document.getElementById('mic-btn');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsModal = document.getElementById('settings-modal');
        this.closeSettingsBtn = document.getElementById('close-settings-btn');
        this.viewModeToggle = document.getElementById('view-mode-toggle');
        this.brainToggleBtn = document.getElementById('brain-toggle-btn');

        // Written text & Voice Controls
        this.dialogueUserPrompt = document.getElementById('dialogue-user-prompt');
        this.dialogueUserText = document.getElementById('dialogue-user-text');
        this.btnReplayVoice = document.getElementById('btn-replay-voice');
        this.btnCopyReply = document.getElementById('btn-copy-reply');
        this.btnToggleChatLog = document.getElementById('btn-toggle-chat-log');
        this.chatHistoryModal = document.getElementById('chat-history-modal');
        this.chatHistoryList = document.getElementById('chat-history-list');
        this.closeChatHistoryBtn = document.getElementById('close-chat-history-btn');
        this.btnCloseChatHistory = document.getElementById('btn-close-chat-history');
        this.btnClearChatHistory = document.getElementById('btn-clear-chat-history');

        this.chatTurns = [];
        this.lastMikuResponse = {
            action: 'wave',
            rawText: "Konnichiwa! I'm Hatsune Miku! Running locally & offline with nchapman/dolphin3.0-qwen2.5:3b! 🎵✨",
            speechText: "Konnichiwa! I'm Hatsune Miku! Running locally and offline with Dolphin 3.0!"
        };

        this.init();
    }

    getAiClient() {
        return this.aiProvider === 'ollama' ? this.ollama : this.gemini;
    }

    async init() {
        this.applyViewMode(this.viewMode);
        this.bindUserControls();
        this.bindDialogueActions();
        this.bindMotionControls();
        this.bindSettings();
        this.updateBrainToggleUI();

        // Prime audio context on any user click on document
        const unlockAudio = () => {
            this.tts.primeAudio();
            this.visualizer.ensureAudioContext();
            window.removeEventListener('click', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
        };
        window.addEventListener('click', unlockAudio);
        window.addEventListener('keydown', unlockAudio);

        // Check if local Ollama is active on startup
        try {
            const models = await this.ollama.listAvailableModels();
            if (models && models.length > 0) {
                console.log(`[Init] Local Ollama detected with ${models.length} models:`, models);
                if (!localStorage.getItem('ai_provider') || (this.aiProvider === 'gemini' && !this.gemini.apiKey)) {
                    this.aiProvider = 'ollama';
                    localStorage.setItem('ai_provider', 'ollama');
                }
            }
        } catch (e) {
            console.warn('[Init] Local Ollama ping failed:', e.message);
        }

        this.updateBrainToggleUI();

        if (this.aiProvider === 'ollama') {
            this.setStatus('idle', `Ollama: ${this.ollama.model} (Offline)`);
            this.showSubtitle("Miku", `Konnichiwa! I'm Hatsune Miku! Running locally & offline with ${this.ollama.model}! 🎵✨`, 'happy');
            this.executeMotion('wave');
        } else {
            if (!this.gemini.apiKey) {
                this.setStatus('idle', 'Gemini API Key required');
                setTimeout(() => { this.openSettings(true); }, 600);
            } else {
                this.setStatus('idle', `Gemini: ${this.gemini.model}`);
                this.showSubtitle("Miku", "Konnichiwa! I'm Hatsune Miku! I can move and talk in any language! ✨", 'happy');
                this.executeMotion('wave');
            }
        }
    }

    updateBrainToggleUI() {
        if (!this.brainToggleBtn) return;
        if (this.aiProvider === 'ollama') {
            this.brainToggleBtn.textContent = '🦙 Ollama (Offline)';
            this.brainToggleBtn.title = 'Active Engine: 100% Local Ollama (Completely offline). Click to switch to Gemini Cloud.';
            this.brainToggleBtn.style.borderColor = 'var(--miku-cyan)';
            this.brainToggleBtn.style.color = 'var(--miku-cyan)';
        } else {
            this.brainToggleBtn.textContent = '☁️ Gemini (Cloud)';
            this.brainToggleBtn.title = 'Active Engine: Google Gemini Cloud. Click to switch to Local Ollama.';
            this.brainToggleBtn.style.borderColor = 'var(--miku-pink)';
            this.brainToggleBtn.style.color = 'var(--miku-pink)';
        }
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
            this.setStatus('idle', `Ollama: ${this.ollama.model} (Offline)`);
            this.showSubtitle("Miku", `Switched to 100% offline local AI (${this.ollama.model})! 🦙✨`, 'happy');
            this.executeMotion('wave');
        } else {
            this.setStatus('idle', `Gemini: ${this.gemini.model}`);
            this.showSubtitle("Miku", `Switched to Google Gemini Cloud (${this.gemini.model})! ☁️✨`, 'happy');
            this.executeMotion('wave');
        }
    }

    applyViewMode(mode) {
        this.viewMode = mode;
        localStorage.setItem('miku_view_mode', mode);

        if (mode === '3d') {
            this.container3D.style.display = 'block';
            this.container2D.style.display = 'none';
            if (this.viewModeToggle) this.viewModeToggle.textContent = 'Switch to 2D Mode 🎨';
            if (this.miku3D) {
                this.miku3D.handleResize();
            }
        } else {
            this.container3D.style.display = 'none';
            this.container2D.style.display = 'flex';
            if (this.viewModeToggle) this.viewModeToggle.textContent = 'Switch to 3D Mode 🌟';
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
        // Highlight active motion button in UI
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
            switch (actionName) {
                case 'wave':        this.miku3D.wave(); break;
                case 'nod':         this.miku3D.nod(); break;
                case 'cross_arms':
                case 'crossArms':   this.miku3D.crossArms(); break;
                case 'reach':
                case 'reachHand':   this.miku3D.reachHand(); break;
                case 'shy':         this.miku3D.shyPose(); break;
                case 'think':       this.miku3D.thinkPose(); break;
                case 'pout':        this.miku3D.poutPose(); break;
                case 'shake_head':
                case 'shakeHead':   this.miku3D.shakeHead(); break;
                case 'wink':        this.miku3D.wink(); break;
                case 'cheer':
                case 'celebrate':   this.miku3D.cheer(); break;
                default:            this.miku3D.setAction('idle'); break;
            }
        } else {
            const poseMap = {
                wave: 'happy',
                reach: 'happy',
                cheer: 'happy',
                celebrate: 'happy',
                wink: 'happy',
                cross_arms: 'neutral',
                shy: 'shy',
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
                this.tts.primeAudio();
                this.handleUserSubmit();
            }
        });

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

        // Microphone Button: Click once to talk, click again to immediately submit!
        this.micBtn.addEventListener('click', () => {
            this.tts.primeAudio();
            if (this.status === 'listening') {
                this.stt.triggerFinalResult();
            } else {
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
        const isModalOpen = () => (this.settingsModal && this.settingsModal.classList.contains('active')) ||
                                  (this.chatHistoryModal && this.chatHistoryModal.classList.contains('active'));

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && document.activeElement !== this.userInput && !isModalOpen()) {
                if (this.status !== 'listening' && this.status !== 'thinking') {
                    e.preventDefault();
                    this.tts.primeAudio();
                    this.startListening();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && document.activeElement !== this.userInput && !isModalOpen()) {
                if (this.status === 'listening') {
                    e.preventDefault();
                    this.stt.triggerFinalResult();
                }
            }
        });
    }

    bindDialogueActions() {
        // 🔊 Replay Voice Button: Immediately speaks Miku's response with 3D lip-sync & animation
        if (this.btnReplayVoice) {
            this.btnReplayVoice.addEventListener('click', () => {
                this.tts.primeAudio();
                if (this.lastMikuResponse) {
                    this.speakMikuResponse(this.lastMikuResponse.speechText, this.lastMikuResponse.action);
                } else {
                    const text = this.subtitleText.textContent.trim();
                    if (text) this.speakMikuResponse(text, 'wave');
                }
            });
        }

        // 📋 Copy Button: Copies Miku's written text to clipboard
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

        // 💬 Chat History Log Modal
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
                    No conversation history yet. Start speaking or typing to Miku! 🎵
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

        // Auto-scroll transcript container to latest turn
        this.chatHistoryList.scrollTop = this.chatHistoryList.scrollHeight;

        // Wire turn buttons
        const speakBtns = this.chatHistoryList.querySelectorAll('.btn-turn-speak');
        speakBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx, 10);
                const turn = this.chatTurns[idx];
                if (turn) {
                    this.executeMotion(turn.action || 'wave');
                    this.speakMikuResponse(turn.speechText || turn.text, turn.action || 'wave');
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

        // Auto-scroll to bottom
        this.chatHistoryList.scrollTop = this.chatHistoryList.scrollHeight;
    }

    startListening() {
        this.tts.stop();
        this.setStatus('listening', 'Listening to you...');
        this.showSubtitle("You", "Listening... (Speak now)", 'neutral');
        this.executeMotion('think');

        this.stt.start(
            (finalText) => {
                if (finalText && finalText.trim()) {
                    this.userInput.value = finalText.trim();
                    this.tts.primeAudio();
                    this.handleUserSubmit();
                } else {
                    this.setStatus('idle', 'Ready');
                }
            },
            (interimText) => {
                this.showSubtitle("You", interimText, 'neutral');
                this.visualizer.setSimulatedVolume(0.45 + Math.random() * 0.4);
            },
            () => { this.setStatus('listening', 'Miku is listening...'); },
            () => {
                if (this.status === 'listening') this.setStatus('idle', 'Ready');
                this.visualizer.setSimulatedVolume(0);
            },
            (err) => { this.setStatus('idle', `Mic: ${err}`); }
        );
    }

    async handleUserSubmit() {
        const text = this.userInput.value.trim();
        if (!text) return;

        this.userInput.value = '';
        this.tts.stop();
        this.stt.stop();

        // 1. Display user prompt in upper preview badge so user context never disappears
        if (this.dialogueUserPrompt && this.dialogueUserText) {
            this.dialogueUserPrompt.style.display = 'flex';
            this.dialogueUserText.textContent = text;
        }

        // 2. Add user turn to conversation transcript
        this.addChatTurn('user', text);

        const isOllama = this.aiProvider === 'ollama';
        const providerName = isOllama
            ? `Local Ollama (${this.ollama.model})` 
            : `Gemini (${this.gemini.model})`;
        const providerShort = isOllama ? 'Dolphin 3.0' : 'Gemini';

        this.setStatus('thinking', `Miku is thinking via ${providerName}...`);
        this.executeMotion('think');

        // 3. Immediately show thinking animation in dialogue card
        const thinkingTimeout = setTimeout(() => {
            if (this.status === 'thinking') {
                this.showSubtitleHtml("Miku", `
                    <div class="thinking-wave">
                        <span>Thinking via ${providerShort}</span>
                        <span class="thinking-dots">
                            <span class="thinking-dot"></span>
                            <span class="thinking-dot"></span>
                            <span class="thinking-dot"></span>
                        </span>
                    </div>
                `);
            }
        }, 180);

        try {
            const aiClient = this.getAiClient();
            let actionFired = false;

            if (isOllama) {
                // Real-time token streaming with live written text updates & instant gesture trigger!
                const result = await aiClient.sendMessageStream(
                    text,
                    (chunk) => {
                        clearTimeout(thinkingTimeout);
                        if (!actionFired && chunk.action && chunk.action !== 'idle') {
                            actionFired = true;
                            this.executeMotion(chunk.action);
                        }
                        this.showSubtitleHtml("Miku", `${chunk.partialText}<span class="streaming-cursor"></span>`);
                    },
                    (detectedAction) => {
                        if (!actionFired && detectedAction) {
                            actionFired = true;
                            this.executeMotion(detectedAction);
                        }
                    }
                );

                clearTimeout(thinkingTimeout);
                this.handleMikuResponse(result);
            } else {
                // Gemini API multi-turn call
                const result = await aiClient.sendMessage(text);
                clearTimeout(thinkingTimeout);
                this.handleMikuResponse(result);
            }
        } catch (err) {
            clearTimeout(thinkingTimeout);
            console.error("AI Generation Error:", err);
            this.setStatus('idle', 'Error occurred');

            let helpfulAdvice = err.message;
            if (isOllama && err.message.includes('Cannot connect')) {
                helpfulAdvice = `Could not connect to Ollama at ${this.ollama.host}. Is Ollama running in background? (Try starting 'ollama serve' or open Ollama app). You can also click the top Brain button to switch to Gemini!`;
            }

            this.showSubtitle("Miku", `Oops! ${helpfulAdvice}`, 'crying');
            this.executeMotion('shy');
        }
    }

    handleMikuResponse(response) {
        const { action, rawText, speechText } = response;
        this.lastMikuResponse = response;

        // 1. Display written text of what she replied prominently in the dialogue card
        this.showSubtitle("Miku", rawText, action);

        // 2. Add Miku's turn to written chat transcript
        this.addChatTurn('miku', rawText, action, speechText);

        // 3. Immediately speak the response aloud with real-time lip-sync & 3D body motion!
        this.speakMikuResponse(speechText, action);
    }

    speakMikuResponse(speechText, action = 'wave') {
        this.setStatus('speaking', `Miku is speaking [${action}]`);
        this.executeMotion(action);

        if (this.btnReplayVoice) {
            this.btnReplayVoice.classList.remove('pulse-glow');
            this.btnReplayVoice.textContent = '🔊 Speaking...';
        }

        // Real-time lip-sync driving 3D and 2D mouths
        this.tts.speak(
            speechText,
            (openness) => {
                this.miku3D.setMouthOpenness(openness);
                this.avatar2D.setMouthOpenness(openness);
                this.visualizer.setSimulatedVolume(openness);
            },
            (voiceName) => {
                this.setStatus('speaking', `Speaking (${voiceName})`);
            },
            () => {
                this.miku3D.setMouthOpenness(0);
                this.avatar2D.setMouthOpenness(0);
                this.visualizer.setSimulatedVolume(0);
                this.setStatus('idle', 'Ready to chat');
                if (this.btnReplayVoice) {
                    this.btnReplayVoice.textContent = '🔊 Replay Voice';
                }
            },
            (errCode) => {
                console.warn("[TTS] Voice output notice:", errCode);
                if (this.btnReplayVoice) {
                    this.btnReplayVoice.textContent = '🔊 Click to Speak Voice';
                    this.btnReplayVoice.classList.add('pulse-glow');
                }
            }
        );
    }

    showSubtitle(speaker, text, emotion = 'neutral') {
        this.dialogueCard.classList.remove('hidden');
        this.speakerName.textContent = speaker;
        this.speakerName.className = `speaker-label ${speaker.toLowerCase()}`;
        this.subtitleText.textContent = text;

        if (window.gsap) {
            gsap.fromTo(this.dialogueCard, { y: 4, opacity: 0.9 }, { y: 0, opacity: 1, duration: 0.25, ease: "power2.out" });
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

        // Provider Selector
        const providerSelect = document.getElementById('cfg-ai-provider');
        const ollamaSection = document.getElementById('section-ollama-settings');
        const geminiSection = document.getElementById('section-gemini-settings');

        // Ollama Inputs
        const ollamaHostInput = document.getElementById('cfg-ollama-host');
        const ollamaModelSelect = document.getElementById('cfg-ollama-model');
        const ollamaCustomInput = document.getElementById('cfg-ollama-custom-model');
        const btnDetectOllama = document.getElementById('btn-detect-ollama');
        const ollamaDetectStatus = document.getElementById('ollama-detect-status');
        const btnTestOllama = document.getElementById('btn-test-ollama');
        const ollamaDiagPanel = document.getElementById('ollama-diagnostics-panel');

        // Gemini Inputs
        const apiKeyInput = document.getElementById('cfg-api-key');
        const modelSelect = document.getElementById('cfg-model');
        const customModelInput = document.getElementById('cfg-custom-model');
        const detectBtn = document.getElementById('btn-detect-models');
        const detectStatus = document.getElementById('model-detect-status');
        const diagBtn = document.getElementById('btn-run-diagnostics');
        const diagPanel = document.getElementById('diagnostics-panel');

        // Speech & Audio Inputs
        const langSelect = document.getElementById('cfg-stt-lang');
        const voiceSelect = document.getElementById('cfg-tts-voice');
        const pitchSlider = document.getElementById('cfg-tts-pitch');
        const rateSlider = document.getElementById('cfg-tts-rate');
        const pitchVal = document.getElementById('cfg-pitch-val');
        const rateVal = document.getElementById('cfg-rate-val');

        const testVoiceBtn = document.getElementById('btn-test-voice');
        const saveBtn = document.getElementById('btn-save-settings');

        // 1. Initialize Provider Selection
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

        // 2. Initialize Ollama Fields
        if (ollamaHostInput) ollamaHostInput.value = this.ollama.host;
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

        // Detect Local Ollama Models
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
                        models.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m;
                            opt.textContent = m === 'nchapman/dolphin3.0-qwen2.5:3b' 
                                ? `${m} (Recommended Dolphin Idol)` 
                                : m;
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

        // Live Test Ollama Connection
        if (btnTestOllama) {
            btnTestOllama.addEventListener('click', async () => {
                const host = (ollamaHostInput?.value || this.ollama.host).trim();
                const chosenModel = (ollamaModelSelect.value === 'custom' && ollamaCustomInput && ollamaCustomInput.value.trim())
                    ? ollamaCustomInput.value.trim()
                    : ollamaModelSelect.value;

                this.ollama.setHost(host);
                this.ollama.setModel(chosenModel);

                if (ollamaDiagPanel) {
                    ollamaDiagPanel.style.display = 'block';
                    ollamaDiagPanel.innerHTML = '<span style="color:var(--miku-cyan)">⏳ Ping testing local Ollama instance & model...</span>';
                }
                btnTestOllama.disabled = true;

                try {
                    const diag = await this.ollama.runDiagnostics();
                    if (ollamaDiagPanel) {
                        if (diag.success) {
                            ollamaDiagPanel.innerHTML = `
                                <div style="color:#00f3ff; margin-bottom:3px;">✅ <strong>Local Ollama Online & Ready!</strong></div>
                                <div>• Host: <code>${diag.host}</code></div>
                                <div>• Active Model: <strong>${diag.model}</strong></div>
                                <div>• Roundtrip Latency: <strong>${diag.latencyMs}ms</strong> (Completely offline & local)</div>
                                <div style="color:#39c5bb; margin-top:4px;">✨ 100% private, free & offline operation confirmed.</div>
                            `;
                        } else {
                            ollamaDiagPanel.innerHTML = `
                                <div style="color:#ff6b6b; margin-bottom:3px;">❌ <strong>Ollama Offline or Error:</strong></div>
                                <div>${diag.error}</div>
                                <div style="color:#ffaa44; margin-top:4px;">💡 Tip: Open terminal and type <code>ollama serve</code> or launch the Ollama app.</div>
                            `;
                        }
                    }
                } catch (e) {
                    if (ollamaDiagPanel) {
                        ollamaDiagPanel.innerHTML = `<span style="color:#ff6b6b">❌ Diagnostic error: ${e.message}</span>`;
                    }
                } finally {
                    btnTestOllama.disabled = false;
                }
            });
        }

        // 3. Initialize Gemini Fields
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
                    const models = await this.gemini.listModels(key);
                    if (models && models.length > 0) {
                        modelSelect.innerHTML = '';
                        const topModels = ['gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-2.5-flash'];
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

                        if (models.includes(this.gemini.model) || topModels.includes(this.gemini.model)) {
                            modelSelect.value = this.gemini.model;
                        } else {
                            modelSelect.value = models[0];
                        }

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
                            summary = `<div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(255,255,255,0.2); color:#39c5bb;"><strong>Recommended Active Model:</strong> ${diag.recommendedModel} (Auto-selected in dropdown)</div>`;
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

        // 4. Speech and Audio Settings
        langSelect.value = this.stt.language;
        pitchSlider.value = this.tts.pitch;
        rateSlider.value = this.tts.rate;
        pitchVal.textContent = this.tts.pitch;
        rateVal.textContent = this.tts.rate;

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
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = populateVoices;
        }

        pitchSlider.addEventListener('input', () => { pitchVal.textContent = pitchSlider.value; });
        rateSlider.addEventListener('input', () => { rateVal.textContent = rateSlider.value; });

        testVoiceBtn.addEventListener('click', () => {
            this.tts.primeAudio();
            this.tts.setPitch(pitchSlider.value);
            this.tts.setRate(rateSlider.value);
            this.tts.setVoice(voiceSelect.value);

            this.executeMotion('wave');
            this.tts.speak(
                "Konnichiwa! I'm Hatsune Miku! Look, I'm moving and talking through real-time code instructions! 🎵",
                (openness) => {
                    this.miku3D.setMouthOpenness(openness);
                    this.visualizer.setSimulatedVolume(openness);
                },
                () => { this.setStatus('speaking', 'Testing Voice & 3D Motion...'); },
                () => {
                    this.miku3D.setMouthOpenness(0);
                    this.visualizer.setSimulatedVolume(0);
                    this.setStatus('idle', 'Ready');
                }
            );
        });

        // 5. Save Settings
        saveBtn.addEventListener('click', () => {
            const selectedProvider = providerSelect ? providerSelect.value : 'ollama';
            this.aiProvider = selectedProvider;
            localStorage.setItem('ai_provider', selectedProvider);
            this.updateBrainToggleUI();

            // Save Ollama settings
            if (ollamaHostInput) this.ollama.setHost(ollamaHostInput.value.trim());
            const chosenOllamaModel = (ollamaModelSelect.value === 'custom' && ollamaCustomInput && ollamaCustomInput.value.trim())
                ? ollamaCustomInput.value.trim()
                : ollamaModelSelect.value;
            this.ollama.setModel(chosenOllamaModel);

            // Save Gemini settings
            const chosenGeminiModel = (modelSelect.value === 'custom' && customModelInput && customModelInput.value.trim())
                ? customModelInput.value.trim()
                : modelSelect.value;
            this.gemini.setApiKey(apiKeyInput.value.trim());
            this.gemini.setModel(chosenGeminiModel);

            // Save Audio settings
            this.stt.setLanguage(langSelect.value);
            this.tts.setVoice(voiceSelect.value);
            this.tts.setPitch(pitchSlider.value);
            this.tts.setRate(rateSlider.value);

            this.closeSettings();

            if (selectedProvider === 'ollama') {
                this.setStatus('idle', `Ollama: ${chosenOllamaModel} (Offline)`);
                this.showSubtitle("Miku", `Settings saved! Using local offline AI: ${chosenOllamaModel}! 🦙✨`, 'happy');
            } else {
                this.setStatus('idle', `Gemini: ${chosenGeminiModel}`);
                this.showSubtitle("Miku", `Settings saved! Model is set to ${chosenGeminiModel}! ✨`, 'happy');
            }
            this.executeMotion('nod');
        });
    }

    openSettings(highlightKey = false) {
        this.settingsModal.classList.add('active');
        const providerSelect = document.getElementById('cfg-ai-provider');
        const ollamaHostInput = document.getElementById('cfg-ollama-host');
        const ollamaModelSelect = document.getElementById('cfg-ollama-model');
        const apiKeyInput = document.getElementById('cfg-api-key');

        if (providerSelect) providerSelect.value = this.aiProvider;
        if (ollamaHostInput) ollamaHostInput.value = this.ollama.host;
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
