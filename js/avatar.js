/**
 * Avatar Animation Engine: Multi-pose state machine, dynamic lip-sync, blinking & gaze tracking
 */
export class AvatarEngine {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentPose = 'neutral';
        this.mouthOpenness = 0;       // 0 (closed) to 1 (wide open)
        this.targetOpenness = 0;
        this.isBlinking = false;
        this.blinkTimer = null;
        this.animationFrameId = null;

        // Pose image mapping (using images in img/ folder)
        this.poses = {
            neutral:  'img/m1.jpg', // Arms crossed, pout/listening
            talking:  'img/m2.jpg', // Over shoulder, talking back
            happy:    'img/m3.jpg', // Arms open, bright smile
            grateful: 'img/m4.jpg', // Hands clasped, sweet blush
            shy:      'img/m5.jpg', // Flustered, twintails held
            crying:   'img/m6.jpg', // Teary/embarrassed
            cool:     'img/m7.jpg', // Black hoodie, cool pose
            cat:      'img/m8.jpg', // Cat hoodie & cat on shoulder
            pout:     'img/m1.jpg'
        };

        // Calibrated coordinates on m1.jpg (relative percentages 0..100)
        this.calibration = JSON.parse(localStorage.getItem('miku_avatar_calibration')) || {
            mouthX: 52.8,   // % from left
            mouthY: 46.5,   // % from top
            mouthScale: 1.0,
            enableLipSync: true,
            enableBlink: true,
            enableFloat: true,
            enableGaze: true,
            transparentBg: true
        };

        this.mousePos = { x: 0.5, y: 0.5 };
        this.currentLook = { x: 0, y: 0 };

        this.initDOM();
        this.setupGazeTracking();
        this.startBlinkLoop();
        this.startRenderLoop();
    }

    initDOM() {
        this.container.innerHTML = `
            <div class="avatar-stage ${this.calibration.enableFloat ? 'floating' : ''}">
                <div class="avatar-card ${this.calibration.transparentBg ? 'blend-mode' : ''}">
                    <img id="avatar-img-back" class="avatar-img back" src="${this.poses.neutral}" alt="Avatar">
                    <img id="avatar-img-front" class="avatar-img front visible" src="${this.poses.neutral}" alt="Avatar">
                    <canvas id="avatar-overlay-canvas" class="avatar-overlay"></canvas>
                </div>
                <div class="avatar-shadow"></div>
                <div class="avatar-halo"></div>
            </div>
        `;

        this.card = this.container.querySelector('.avatar-card');
        this.imgFront = this.container.querySelector('#avatar-img-front');
        this.imgBack = this.container.querySelector('#avatar-img-back');
        this.canvas = this.container.querySelector('#avatar-overlay-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Synchronize canvas dimensions whenever the image loads or resizes
        this.imgFront.onload = () => this.syncCanvasSize();
        window.addEventListener('resize', () => this.syncCanvasSize());
        setTimeout(() => this.syncCanvasSize(), 200);
    }

    syncCanvasSize() {
        if (!this.imgFront || !this.canvas) return;
        const rect = this.imgFront.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.canvas.width = this.imgFront.naturalWidth || rect.width;
            this.canvas.height = this.imgFront.naturalHeight || rect.height;
        }
    }

    setPose(emotionName) {
        const poseKey = this.poses[emotionName] ? emotionName : 'neutral';
        if (this.currentPose === poseKey) return;

        this.currentPose = poseKey;
        const newSrc = this.poses[poseKey];

        // Smooth cross-fade between front and back images
        this.imgBack.src = this.imgFront.src;
        this.imgFront.classList.remove('visible');

        setTimeout(() => {
            this.imgFront.src = newSrc;
            this.imgFront.onload = () => {
                this.imgFront.classList.add('visible');
                this.syncCanvasSize();
            };
        }, 50);
    }

    setMouthOpenness(val) {
        this.targetOpenness = Math.max(0, Math.min(1, val));
    }

    startBlinkLoop() {
        const scheduleNextBlink = () => {
            const delay = 2800 + Math.random() * 3200;
            this.blinkTimer = setTimeout(() => {
                if (this.calibration.enableBlink && (this.currentPose === 'neutral' || this.currentPose === 'cool')) {
                    this.isBlinking = true;
                    // Natural blink duration ~130ms
                    setTimeout(() => {
                        this.isBlinking = false;
                        // 20% chance of an authentic double-blink
                        if (Math.random() < 0.22) {
                            setTimeout(() => {
                                this.isBlinking = true;
                                setTimeout(() => { this.isBlinking = false; }, 100);
                            }, 120);
                        }
                    }, 130);
                }
                scheduleNextBlink();
            }, delay);
        };
        scheduleNextBlink();
    }

    setupGazeTracking() {
        window.addEventListener('mousemove', (e) => {
            if (!this.calibration.enableGaze) return;
            const normX = (e.clientX / window.innerWidth) - 0.5;
            const normY = (e.clientY / window.innerHeight) - 0.5;
            this.mousePos.x = normX;
            this.mousePos.y = normY;
        });
    }

    startRenderLoop() {
        const loop = () => {
            this.render();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        loop();
    }

    render() {
        // Smoothly interpolate mouth openness (lerp)
        this.mouthOpenness += (this.targetOpenness - this.mouthOpenness) * 0.35;

        // Apply 2.5D gaze tilt
        if (this.card && this.calibration.enableGaze) {
            this.currentLook.x += (this.mousePos.x * 12 - this.currentLook.x) * 0.08;
            this.currentLook.y += (this.mousePos.y * 10 - this.currentLook.y) * 0.08;
            this.card.style.transform = `perspective(1000px) rotateY(${this.currentLook.x}deg) rotateX(${-this.currentLook.y}deg)`;
        }

        // Draw dynamic lip-sync and eyes on overlay canvas
        this.drawOverlay();
    }

    drawOverlay() {
        if (!this.ctx || !this.canvas) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.clearRect(0, 0, w, h);

        // Only render lip-sync overlay if enabled and on frontal/neutral poses (m1)
        if (this.calibration.enableLipSync && (this.currentPose === 'neutral' || this.currentPose === 'pout')) {
            const mx = (this.calibration.mouthX / 100) * w;
            const my = (this.calibration.mouthY / 100) * h;
            const scale = (w / 735) * this.calibration.mouthScale;

            if (this.mouthOpenness > 0.06) {
                this.drawAnimeMouth(mx, my, this.mouthOpenness, scale);
            }
        }

        // Draw natural eye-blinking if enabled on m1
        if (this.calibration.enableBlink && this.isBlinking && (this.currentPose === 'neutral' || this.currentPose === 'pout')) {
            const scale = (w / 735);
            this.drawAnimeBlink(w, h, scale);
        }
    }

    /**
     * Renders a clean anime-styled mouth with lip line, interior cavity, teeth and tongue
     */
    drawAnimeMouth(cx, cy, openness, scale) {
        const ctx = this.ctx;
        ctx.save();

        const mouthWidth = (28 + openness * 18) * scale;
        const mouthHeight = (openness * 32) * scale;

        // 1. Clean skin-patch covering the static closed mouth line seamlessly
        ctx.beginPath();
        ctx.ellipse(cx, cy, mouthWidth * 0.9, Math.max(10 * scale, mouthHeight * 0.8), 0, 0, Math.PI * 2);
        ctx.fillStyle = '#fff4ee'; // Miku soft anime skin tone
        ctx.fill();

        // 2. Mouth Interior Cavity
        ctx.beginPath();
        // Anime mouth shape: slightly curved upper lip, deeper curved lower lip
        ctx.moveTo(cx - mouthWidth / 2, cy);
        ctx.quadraticCurveTo(cx, cy - mouthHeight * 0.25, cx + mouthWidth / 2, cy);
        ctx.quadraticCurveTo(cx, cy + mouthHeight * 1.5, cx - mouthWidth / 2, cy);
        ctx.closePath();

        // Mouth interior gradient
        const mouthGrad = ctx.createLinearGradient(cx, cy - 5, cx, cy + mouthHeight);
        mouthGrad.addColorStop(0, '#852d3a');
        mouthGrad.addColorStop(1, '#db5a6b');
        ctx.fillStyle = mouthGrad;
        ctx.fill();

        // 3. Cute White Tooth Line (Upper teeth)
        if (openness > 0.25) {
            ctx.save();
            ctx.clip();
            ctx.beginPath();
            ctx.moveTo(cx - mouthWidth * 0.4, cy);
            ctx.quadraticCurveTo(cx, cy - mouthHeight * 0.2, cx + mouthWidth * 0.4, cy);
            ctx.lineTo(cx + mouthWidth * 0.35, cy + mouthHeight * 0.32);
            ctx.quadraticCurveTo(cx, cy + mouthHeight * 0.38, cx - mouthWidth * 0.35, cy + mouthHeight * 0.32);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            // 4. Soft pink tongue at bottom
            if (openness > 0.45) {
                ctx.beginPath();
                ctx.arc(cx, cy + mouthHeight * 1.0, mouthWidth * 0.32, Math.PI, 0);
                ctx.fillStyle = '#ff8299';
                ctx.fill();
            }
            ctx.restore();
        }

        // 5. Dark Anime Outline
        ctx.beginPath();
        ctx.moveTo(cx - mouthWidth / 2, cy);
        ctx.quadraticCurveTo(cx, cy - mouthHeight * 0.25, cx + mouthWidth / 2, cy);
        ctx.quadraticCurveTo(cx, cy + mouthHeight * 1.5, cx - mouthWidth / 2, cy);
        ctx.lineWidth = 2.4 * scale;
        ctx.strokeStyle = '#4a2f35'; // Anime dark contour
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Draws closed curved anime eyelids during a blink
     */
    drawAnimeBlink(w, h, scale) {
        const ctx = this.ctx;
        ctx.save();

        // Left eye center: ~325, ~350. Right eye center: ~428, ~354
        const leftX = (325 / 735) * w;
        const leftY = (350 / 926) * h;
        const rightX = (428 / 735) * w;
        const rightY = (354 / 926) * h;
        const eyeW = 42 * scale;

        const drawEye = (x, y) => {
            // Skin patch to cover the open pupil
            ctx.beginPath();
            ctx.ellipse(x, y, eyeW * 0.85, 20 * scale, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#fff4ee';
            ctx.fill();

            // Anime closed eyelash stroke: cute gentle curve
            ctx.beginPath();
            ctx.moveTo(x - eyeW * 0.7, y + 2 * scale);
            ctx.quadraticCurveTo(x, y + 10 * scale, x + eyeW * 0.7, y);
            ctx.lineWidth = 3.6 * scale;
            ctx.strokeStyle = '#323642';
            ctx.lineCap = 'round';
            ctx.stroke();

            // Lower tiny lash
            ctx.beginPath();
            ctx.moveTo(x - eyeW * 0.35, y + 14 * scale);
            ctx.lineTo(x + eyeW * 0.2, y + 15 * scale);
            ctx.lineWidth = 1.8 * scale;
            ctx.strokeStyle = '#4a4e5c';
            ctx.stroke();
        };

        drawEye(leftX, leftY);
        drawEye(rightX, rightY);

        ctx.restore();
    }

    updateCalibration(newSettings) {
        this.calibration = { ...this.calibration, ...newSettings };
        localStorage.setItem('miku_avatar_calibration', JSON.stringify(this.calibration));

        if (this.card) {
            if (this.calibration.transparentBg) {
                this.card.classList.add('blend-mode');
            } else {
                this.card.classList.remove('blend-mode');
            }
        }

        const stage = this.container.querySelector('.avatar-stage');
        if (stage) {
            if (this.calibration.enableFloat) {
                stage.classList.add('floating');
            } else {
                stage.classList.remove('floating');
            }
        }
    }
}

