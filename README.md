# Hatsune Miku // Authentic 3D Anime AI Voice Assistant 🎵

An interactive, authentic **3D anime desktop voice assistant** powered by **Three.js**, **VRM/GLTFLoader**, **GSAP**, **Local Ollama (100% Offline)**, and **Google Gemini Cloud AI**. It features the world-famous **Hatsune Miku 3D model** with real facial blendshapes, twintail spring hair physics, full 3D skeletal gestures, OrbitControls, and real-time multilingual AI voice conversation!

---

## 🌟 Key Features

1. **Authentic 3D Hatsune Miku Model (`Miku4.vrm`):**
   - **Tda Hatsune Miku V4X:** Cel-shaded anime aesthetic, twintails, headset mic, cyan tie, detached sleeves, and iconic outfit.
   - **63 Facial Morph Targets:** Real 3D facial expressions and phonemes including:
     - `あ` (vowel AA) and `い` (vowel IH) for realistic speech lip-sync.
     - `まばたき` (blinks), `ウィンク` (winks), `笑い` (happy smile), `照れ` (blush), `じと目` (pout).
   - **Humanoid Skeletal Rig (240 Bones):** Head, Neck, Chest, Spine, Pelvis, Shoulders, Arms, Wrists, articulated Fingers, and Hair chains.
   - **Spring Hair Physics:** Real dynamic twintail inertia that sways and bounces with head and body movement!

2. **Dual AI Brain (Local Offline Ollama + Cloud Gemini):**
   - **🦙 Local Ollama (`nchapman/dolphin3.0-qwen2.5:3b`):** Completely offline, zero API keys required, private, streaming responses with real-time gesture triggers!
   - **☁️ Google Gemini API:** Cloud Interactions API with multi-turn server-side state.
   - **One-Click Brain Switcher:** Toggle between Offline Ollama and Cloud Gemini anytime right from the top navigation bar.

3. **11 Dynamic Kinematic Motions (GSAP):**
   - `wave`: Raises arm high and waves cheerfully.
   - `cross_arms`: Folds arms across chest in a confident anime stance.
   - `pout`: Hands on hips with cute pout.
   - `reach`: Extends hand forward welcomingly.
   - `shy`: Hands together near chest with bashful blush.
   - `think`: Hand to cheek, looking upward thoughtfully.
   - `cheer`: Raises both hands with starry celebration eyes.
   - `nod` / `shake_head`: Agreement and disagreement gestures.
   - `wink`: Playful anime wink!
   - `idle`: Natural breathing kinematics with eye saccades and gaze tracking.

4. **Voice & Written Dialogue System:**
   - **Speech Synthesis (TTS) & Lip-Sync:** Audible voice playback driven by Web Speech API with synchronous audio priming to prevent browser timeouts.
   - **Written Dialogue Card:** Live token streaming with typing cursor, speaker tag, and persistent user prompt preview ribbon.
   - **Action Controls:** `🔊 Replay Voice` button to replay Miku's response with 3D lip-sync, and `📋 Copy` button.
   - **Full Written Transcript Modal:** `💬 History` drawer displays all conversation turns with timestamps, role badges, and individual `🔊 Speak` and `📋 Copy` buttons.

5. **Multilingual Speech Recognition (STT):**
   - Click the **🎙️ Mic** button or hold **Spacebar** push-to-talk to speak to Miku in any language.

---

## 🚀 How to Launch

1. Double-click **`start.bat`** in this directory.
2. The launcher will automatically detect Ollama / Apache and open your browser at:
   ```text
   http://localhost:8080/index.html
   ```
3. Talk or type to Miku in any language!
