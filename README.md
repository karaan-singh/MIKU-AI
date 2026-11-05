# Hatsune Miku // Authentic 3D Anime AI Voice Assistant 🎵

An interactive, authentic **3D anime character voice assistant** powered by **Three.js**, **GLTFLoader**, **GSAP**, and the **Google Gemini API**. It features the world-famous **Tda Hatsune Miku V4X 3D model** with real facial blendshapes, twintail spring hair physics, full 3D skeletal gestures, OrbitControls, and real-time multilingual AI voice conversation!

---

## 🌟 Key Features

1. **Authentic 3D Hatsune Miku Model (`Miku4.vrm`):**
   - **Tda Hatsune Miku V4X:** The definitive 3D anime model of Hatsune Miku, featuring high-poly cel-shaded hair, twintails, headset mic, collar, cyan tie, detached sleeves, and iconic outfit.
   - **63 Facial Morph Targets:** Real 3D facial expressions and phonemes including:
     - `あ` (vowel AA) and `い` (vowel IH) for realistic speech lip-sync.
     - `まばたき` (eyelid blinks), `ウィンク` (winks), `笑い` (happy smile), `照れ` (bashful blush), `じと目` (tsundere pout), `怒り` (playful annoyance).
   - **Humanoid Skeletal Rig (240 Bones):** Head, Neck, Chest, Spine, Pelvis, Shoulders, Upper Arms, Elbows, Wrists, Fingers, and Hair chains.
   - **Spring Hair Physics:** Real dynamic inertia on twintails (`左髪１..９` and `右髪１..９`) that sway, bounce, and settle with head and body movement!

2. **Move As Instructed Through Code (GSAP Kinematics):**
   - `miku3d.wave()`: Raises arm high and waves back and forth with lively anime bounce (`back.out(1.6)`).
   - `miku3d.crossArms()`: Folds arms across chest in a confident tsundere stance (*Recreating `m1.jpg`*).
   - `miku3d.reachHand()`: Extends hand forward welcomingly (*Recreating `m3.jpg`*).
   - `miku3d.shyPose()`: Brings hands together near chin with blushing cheeks (*Recreating `m4.jpg` and `m5.jpg`*).
   - `miku3d.thinkPose()`: Hand to chin, looking upward thoughtfully.
   - `miku3d.nod()` / `miku3d.shakeHead()`: Damped sinusoidal agreement and disagreement.
   - `miku3d.wink()`: Playful anime wink!
   - `miku3d.setMouthOpenness(val)`: Real-time lip-sync driving 3D vowel morph targets.

3. **Multilingual AI Brain (Gemini API):**
   - Speaks and understands **any language** (English, Japanese, Spanish, Hindi, French, Korean, Chinese, German, etc.).
   - Automatically outputs physical action tags (`[wave]`, `[nod]`, `[cross_arms]`, `[reach]`, `[shy]`, `[think]`, `[pout]`, `[wink]`) so the 3D character moves in real-time as it replies!

4. **Interactive Controls & 360 Exploration:**
   - **OrbitControls:** Click and drag with mouse to view Miku in full 3D from any angle.
   - **Gaze Tracking:** Head and eyes naturally track cursor position when idle.
   - **View Switcher:** Toggle between **3D Model** and **2D Illustrated Mode** anytime.

---

## 🚀 How to Launch

1. Double-click **`start.bat`** in this directory.
2. The browser will open:
   ```text
   http://localhost:8080/index.html
   ```
3. Enter your **Gemini API Key** in Settings (⚙️).
4. Click **🧪 Test Voice & Motion** or start speaking with the **🎙️ Mic** or by holding **Spacebar**!
