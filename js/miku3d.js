/**
 * Miku3D: Human-Like Living Animation & Expression Engine (Three.js + GSAP)
 * 
 * Implements the 12 Principles of Animation for ultra-natural human behavior:
 * - Asymmetrical breathing cycles (chest elevation, shoulder rise, natural pauses)
 * - Living eye saccades & micro-darts with eyeball bone tracking (両目)
 * - Distributed cervical spine rotation (hips 10%, spine 15%, chest 20%, neck 25%, head 30%)
 * - Relaxed finger kinematics & articulated hand postures
 * - Speech co-articulation (dynamic blending of phonemes 'あ', 'い', 'お', and lip corners)
 * - Emotional micro-expressions (eyebrow sympathy, cheek blushes, eyelid compression)
 * - Overlapping action & secondary motion (clavicle anticipation, joint delay, twintail drag)
 */

export class Miku3D {
    constructor(canvasContainer) {
        this.container = canvasContainer;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Model & Skeletal references
        this.model = null;
        this.skinnedMeshes = [];
        this.morphNames = {};
        this.bones = {};
        this.defaultRotations = {};
        this.boneMap = {};
        this.hairLeft = [];
        this.hairRight = [];
        this.fingerBones = { right: [], left: [] };

        // GSAP Timelines & Queues
        this.activeTimeline = null;
        this.idleTimeline = null;
        this.pendingAction = null;

        // Living Human State
        this.isLoaded = false;
        this.currentAction = 'idle';
        this.clock = new THREE.Clock();
        this.livingExpressionTimeout = null;

        // Eye Saccades & Living Gaze
        this.mouse = { x: 0, y: 0 };
        this.gaze = { x: 0, y: 0 };
        this.saccade = { x: 0, y: 0 };
        this.lastSaccadeTime = 0;
        this.saccadeInterval = 2.2;

        // Hair physics chains
        this.hairPhysics = {
            leftChain: new Array(8).fill(0),
            leftVel: new Array(8).fill(0),
            rightChain: new Array(8).fill(0),
            rightVel: new Array(8).fill(0)
        };

        this.particles = null;

        this.initWebGL();
        this.loadMikuModel();
        this.createSparkleParticles();
        this.startRenderLoop();
    }

    initWebGL() {
        const width = this.container.clientWidth || 550;
        const height = this.container.clientHeight || 550;

        this.scene = new THREE.Scene();

        // 36° camera framing for full upper-body anime portrait: head down to hips with hands prominently visible
        this.camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
        this.camera.position.set(0, 1.18, 1.82);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.container.appendChild(this.renderer.domElement);

        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.target.set(0, 1.08, 0);
            this.controls.minDistance = 0.8;
            this.controls.maxDistance = 3.5;
            this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
        }

        // 5-Point Anime Portrait Lighting with Dedicated Hand Fill
        const ambient = new THREE.AmbientLight(0xffffff, 1.25);
        this.scene.add(ambient);

        const keyLight = new THREE.DirectionalLight(0xfff7f0, 1.0);
        keyLight.position.set(2, 3, 2.5);
        this.scene.add(keyLight);

        const cyanRim = new THREE.DirectionalLight(0x00f3ff, 0.75);
        cyanRim.position.set(-2.5, 2, -1.5);
        this.scene.add(cyanRim);

        const magentaRim = new THREE.DirectionalLight(0xff3388, 0.6);
        magentaRim.position.set(2.5, 2, -1.5);
        this.scene.add(magentaRim);

        // Gentle upward bounce fill light to keep hands and sleeves brightly rendered
        const fillLight = new THREE.DirectionalLight(0xe8f8ff, 0.45);
        fillLight.position.set(0, -0.6, 2.0);
        this.scene.add(fillLight);

        window.addEventListener('resize', () => this.handleResize());

        window.addEventListener('mousemove', (e) => {
            const rect = this.container.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            this.mouse.x = (e.clientX - cx) / (window.innerWidth / 2);
            this.mouse.y = (e.clientY - cy) / (window.innerHeight / 2);
        });
    }

    handleResize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const w = this.container.clientWidth || 550;
        const h = this.container.clientHeight || 550;
        if (w > 0 && h > 0) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        }
    }

    createSparkleParticles() {
        const count = 45;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 2.5;
            positions[i * 3 + 1] = 0.5 + Math.random() * 1.5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, '#00f3ff');
        grad.addColorStop(0.7, '#39c5bb');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.PointsMaterial({
            size: 0.08,
            map: tex,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0.7
        });

        this.particles = new THREE.Points(geo, mat);
        this.scene.add(this.particles);
    }

    loadMikuModel() {
        const loader = new THREE.GLTFLoader();
        const progressBar = document.getElementById('miku-load-progress-bar');
        const percentText = document.getElementById('miku-load-percent');
        const spinner = document.getElementById('miku-loading-spinner');

        loader.load(
            'Miku4.vrm',
            (gltf) => {
                this.model = gltf.scene;

                // Index skinned meshes and bones
                this.model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.depthWrite = true;
                            child.material.side = THREE.DoubleSide;
                            if (child.material.map) {
                                child.material.map.encoding = THREE.sRGBEncoding;
                                child.material.map.needsUpdate = true;
                            }
                        }
                    }

                    if (child.isSkinnedMesh) {
                        this.skinnedMeshes.push(child);
                        if (child.morphTargetDictionary) {
                            Object.assign(this.morphNames, child.morphTargetDictionary);
                        }
                    }

                    if (child.isBone || child.type === 'Bone') {
                        const name = child.name;
                        this.bones[name] = child;
                        this.defaultRotations[name] = child.rotation.clone();
                    }
                });

                // Humanoid Skeletal Bone Map
                this.boneMap = {
                    head: this.bones['頭'],
                    neck: this.bones['首'],
                    eyes: this.bones['両目'] || this.bones['右目'],
                    leftEye: this.bones['左目'],
                    rightEye: this.bones['右目'],
                    spine: this.bones['上半身'],
                    chest: this.bones['上半身2'],
                    hips: this.bones['腰'],
                    rightShoulder: this.bones['右肩'],
                    rightArm: this.bones['右腕'],
                    rightElbow: this.bones['右ひじ'],
                    rightWrist: this.bones['右手首'],
                    leftShoulder: this.bones['左肩'],
                    leftArm: this.bones['左腕'],
                    leftElbow: this.bones['左ひじ'],
                    leftWrist: this.bones['左手首']
                };

                // Index full 3-joint finger chains
                this.fingerBones = { right: [], left: [] };
                ['人指', '中指', '薬指', '小指', '親指'].forEach((finger) => {
                    for (let j = 1; j <= 3; j++) {
                        if (this.bones[`右${finger}${j}`]) this.fingerBones.right.push(this.bones[`右${finger}${j}`]);
                        if (this.bones[`左${finger}${j}`]) this.fingerBones.left.push(this.bones[`左${finger}${j}`]);
                    }
                });

                // Twintail hair chains
                this.hairLeft = [];
                this.hairRight = [];
                for (let i = 1; i <= 8; i++) {
                    if (this.bones[`左髪${i}`]) this.hairLeft.push(this.bones[`左髪${i}`]);
                    if (this.bones[`右髪${i}`]) this.hairRight.push(this.bones[`右髪${i}`]);
                }

                // Orient character to face directly towards the camera
                this.model.rotation.y = Math.PI;

                this.scene.add(this.model);
                this.isLoaded = true;

                // Fade out loader smoothly
                if (spinner) {
                    if (window.gsap) {
                        gsap.to(spinner, {
                            opacity: 0,
                            duration: 0.5,
                            onComplete: () => { spinner.style.display = 'none'; }
                        });
                    } else {
                        spinner.style.display = 'none';
                    }
                }

                // Initialize living posture, natural fingers, breathing & micro-expressions
                this.setRestPose();
                this.startBlinkScheduler();
                this.startLivingExpressionsLoop();
                this.startIdleMotion();

                if (this.pendingAction) {
                    this.setAction(this.pendingAction);
                    this.pendingAction = null;
                }

                const sub = document.getElementById('subtitle-text');
                if (sub) {
                    sub.textContent = "Konnichiwa! I'm Hatsune Miku! Let's talk! 🎵";
                }

                console.log("3D Hatsune Miku model successfully loaded and initialized!");
            },
            (xhr) => {
                const total = xhr.total || 45130884;
                const percent = Math.min(100, Math.round((xhr.loaded / total) * 100));
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (percentText) percentText.textContent = `${percent}%`;
            },
            (error) => {
                console.error("Error loading Miku 3D model:", error);
                if (percentText) percentText.textContent = "Failed to load model. Check server.";
            }
        );
    }

    /**
     * Natural resting anime pose with forearms angled gracefully forward in front of waist/ribs,
     * ensuring both hands and sleeves are prominently visible in the camera viewport at all times.
     */
    setRestPose() {
        if (!this.isLoaded || !this.boneMap) return;
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        // Relax shoulders with gentle anime slope
        gsap.to(b.rightShoulder.rotation, { z: -0.05, y: 0.04, duration: 0.8 });
        gsap.to(b.leftShoulder.rotation, { z: 0.05, y: -0.04, duration: 0.8 });

        // Right Arm & Forearm: slopes forward-inward, hands clasping/framing midriff visibly
        gsap.to(b.rightArm.rotation, {
            x: 0.14,
            y: -0.14,
            z: -0.98,
            duration: 0.85,
            ease: "power2.out"
        });
        gsap.to(b.rightElbow.rotation, {
            x: 0.35,
            y: 0.82,
            z: 0.08,
            duration: 0.85,
            ease: "power2.out"
        });
        gsap.to(b.rightWrist.rotation, {
            x: 0.20,
            y: 0.16,
            z: 0.24,
            duration: 0.85,
            ease: "power2.out"
        });

        // Left Arm & Forearm: symmetrical forward-inward slope, hand resting beside right hand
        gsap.to(b.leftArm.rotation, {
            x: 0.14,
            y: 0.14,
            z: 0.98,
            duration: 0.85,
            ease: "power2.out"
        });
        gsap.to(b.leftElbow.rotation, {
            x: 0.35,
            y: -0.82,
            z: -0.08,
            duration: 0.85,
            ease: "power2.out"
        });
        gsap.to(b.leftWrist.rotation, {
            x: 0.20,
            y: -0.16,
            z: -0.24,
            duration: 0.85,
            ease: "power2.out"
        });

        // Delicate curved resting fingers with natural anatomical gradation
        this.relaxFingers(this.fingerBones.right, 0.32, 'right');
        this.relaxFingers(this.fingerBones.left, 0.32, 'left');
    }

    /**
     * Gently curl fingers into a natural, graceful anime hand pose.
     * Differentiates individual fingers (index softer, pinky deeper, thumb opposition)
     * and adds subtle lateral splay for organic aesthetics.
     */
    relaxFingers(boneArray, amount = 0.28, handSide = 'right') {
        if (!boneArray || !boneArray.length) return;
        const sideSign = handSide === 'right' ? 1 : -1;

        boneArray.forEach((joint, idx) => {
            const fingerIndex = Math.floor(idx / 3); // 0: Index, 1: Middle, 2: Ring, 3: Pinky, 4: Thumb
            const jointIndex = idx % 3;             // 0: Proximal, 1: Intermediate, 2: Distal

            let curlFactor = 1.0;
            let splayZ = 0;

            if (fingerIndex === 0) {
                // Index finger: slightly straighter, delicate
                curlFactor = jointIndex === 0 ? 0.65 : 0.75;
                if (jointIndex === 0) splayZ = 0.05 * sideSign;
            } else if (fingerIndex === 1) {
                // Middle finger: standard curl
                curlFactor = jointIndex === 0 ? 0.85 : 0.95;
            } else if (fingerIndex === 2) {
                // Ring finger: deeper curl
                curlFactor = jointIndex === 0 ? 1.05 : 1.15;
                if (jointIndex === 0) splayZ = -0.04 * sideSign;
            } else if (fingerIndex === 3) {
                // Pinky finger: tightest curl for classic anime arch
                curlFactor = jointIndex === 0 ? 1.20 : 1.30;
                if (jointIndex === 0) splayZ = -0.09 * sideSign;
            } else if (fingerIndex === 4) {
                // Thumb: opposition fold
                curlFactor = jointIndex === 0 ? 0.45 : (jointIndex === 1 ? 0.55 : 0.65);
                if (jointIndex === 0) splayZ = -0.15 * sideSign;
            }

            const targetX = amount * curlFactor;

            gsap.to(joint.rotation, {
                x: targetX,
                z: splayZ,
                duration: 0.7,
                ease: "power1.out",
                overwrite: "auto"
            });
        });
    }

    /**
     * Set morph target smoothly across all primitives
     */
    setMorph(name, value, duration = 0.08) {
        if (!this.isLoaded || !this.skinnedMeshes.length) return;

        this.skinnedMeshes.forEach((mesh) => {
            const idx = mesh.morphTargetDictionary?.[name];
            if (idx !== undefined) {
                gsap.to(mesh.morphTargetInfluences, {
                    [idx]: value,
                    duration: duration,
                    ease: "power1.out",
                    overwrite: "auto"
                });
            }
        });
    }

    // =========================================================================
    // LIVING HUMAN MOTION & EXPRESSIONS
    // =========================================================================

    killActiveTimeline() {
        if (this.idleTimeline) {
            this.idleTimeline.pause();
        }
        if (this.activeTimeline) {
            this.activeTimeline.kill();
            this.activeTimeline = null;
        }
        if (this.boneMap) {
            const b = this.boneMap;
            gsap.killTweensOf([
                b.rightArm?.rotation, b.rightElbow?.rotation, b.rightWrist?.rotation,
                b.leftArm?.rotation, b.leftElbow?.rotation, b.leftWrist?.rotation,
                b.rightShoulder?.rotation, b.leftShoulder?.rotation,
                b.head?.rotation, b.neck?.rotation, b.spine?.rotation, b.chest?.rotation,
                b.spine?.position, b.hips?.rotation
            ]);
        }
    }

    /**
     * Living Human Micro-Expressions:
     * Subtle, natural facial shifts (blushes, smiling eyes, thinking brow twitches)
     * occurring every 3.5 to 6.5 seconds while in idle so Miku feels genuinely conscious.
     */
    startLivingExpressionsLoop() {
        const triggerMicroExpression = () => {
            const nextDelay = 3500 + Math.random() * 3500;
            this.livingExpressionTimeout = setTimeout(() => {
                if (this.isLoaded && this.currentAction === 'idle') {
                    const moodRoll = Math.random();
                    if (moodRoll < 0.35) {
                        // 1. Soft Daydreaming Smile & Rosy Cheek Blush
                        this.setMorph('にっこり', 0.35, 0.5);
                        this.setMorph('口角上げ', 0.38, 0.5);
                        this.setMorph('照れ', 0.32, 0.6);
                        this.setMorph('にこり', 0.25, 0.5);
                        setTimeout(() => {
                            if (this.currentAction === 'idle') {
                                this.setMorph('にっこり', 0, 0.7);
                                this.setMorph('口角上げ', 0.10, 0.7);
                                this.setMorph('照れ', 0.14, 0.7);
                                this.setMorph('にこり', 0, 0.7);
                            }
                        }, 2200);
                    } else if (moodRoll < 0.60) {
                        // 2. Empathetic / Curious Tilt with softened gaze
                        this.setMorph('困る', 0.28, 0.4);
                        this.setMorph('なごみ', 0.25, 0.4);
                        this.setMorph('口角上げ', 0.20, 0.4);
                        this.setMorph('照れ', 0.22, 0.5);
                        setTimeout(() => {
                            if (this.currentAction === 'idle') {
                                this.setMorph('困る', 0, 0.6);
                                this.setMorph('なごみ', 0, 0.6);
                                this.setMorph('口角上げ', 0.10, 0.6);
                                this.setMorph('照れ', 0.14, 0.6);
                            }
                        }, 2000);
                    } else if (moodRoll < 0.82) {
                        // 3. Cute Confident Smirk / Smug Sparkle
                        this.setMorph('ｷﾘｯ', 0.32, 0.35);
                        this.setMorph('にやり', 0.35, 0.35);
                        this.setMorph('星目', 0.28, 0.4);
                        setTimeout(() => {
                            if (this.currentAction === 'idle') {
                                this.setMorph('ｷﾘｯ', 0, 0.5);
                                this.setMorph('にやり', 0, 0.5);
                                this.setMorph('星目', 0, 0.5);
                            }
                        }, 1800);
                    } else {
                        // 4. Playful Micro-Wink or Cute Blep
                        if (Math.random() < 0.5) {
                            this.setMorph('ウィンク', 0.85, 0.12);
                            this.setMorph('照れ', 0.45, 0.2);
                            this.setMorph('口角上げ', 0.5, 0.2);
                            setTimeout(() => {
                                if (this.currentAction === 'idle') {
                                    this.setMorph('ウィンク', 0, 0.16);
                                    this.setMorph('照れ', 0.14, 0.4);
                                    this.setMorph('口角上げ', 0.10, 0.4);
                                }
                            }, 450);
                        } else {
                            this.setMorph('てへぺろ', 0.45, 0.15);
                            this.setMorph('笑い', 0.35, 0.2);
                            this.setMorph('照れ', 0.40, 0.2);
                            setTimeout(() => {
                                if (this.currentAction === 'idle') {
                                    this.setMorph('てへぺろ', 0, 0.25);
                                    this.setMorph('笑い', 0, 0.35);
                                    this.setMorph('照れ', 0.14, 0.35);
                                }
                            }, 700);
                        }
                    }
                }
                triggerMicroExpression();
            }, nextDelay);
        };
        triggerMicroExpression();
    }

    /**
     * Living Human Idle: Asymmetrical breathing, weight shifting, and natural hand suspension
     */
    startIdleMotion() {
        if (!this.isLoaded || !this.boneMap) return;
        if (this.idleTimeline) this.idleTimeline.kill();

        const b = this.boneMap;
        if (!b.chest || !b.spine || !b.hips) return;

        this.idleTimeline = gsap.timeline({ repeat: -1 });

        // 1. Inhalation (1.7s): Chest elevates and expands, shoulders and forearms rise slightly
        this.idleTimeline.to(b.chest.rotation, {
            x: 0.038,
            duration: 1.7,
            ease: "sine.inOut"
        }, 0);

        this.idleTimeline.to(b.spine.position, {
            y: 0.012,
            duration: 1.7,
            ease: "sine.inOut"
        }, 0);

        this.idleTimeline.to([b.rightShoulder.position, b.leftShoulder.position], {
            y: "+=0.004",
            duration: 1.7,
            ease: "sine.inOut"
        }, 0);

        // Forearms and hands gently float with the inhalation breath
        this.idleTimeline.to(b.rightElbow.rotation, {
            y: "+=0.015",
            duration: 1.7,
            ease: "sine.inOut"
        }, 0);
        this.idleTimeline.to(b.leftElbow.rotation, {
            y: "-=0.015",
            duration: 1.7,
            ease: "sine.inOut"
        }, 0);
        this.idleTimeline.to([b.rightWrist.rotation, b.leftWrist.rotation], {
            x: "+=0.012",
            duration: 1.7,
            ease: "sine.inOut"
        }, 0);

        // 2. Micro-pause at top of breath (0.3s)
        this.idleTimeline.to({}, { duration: 0.3 });

        // 3. Exhalation (2.3s): Relaxed descent and soft deflation
        this.idleTimeline.to(b.chest.rotation, {
            x: -0.01,
            duration: 2.3,
            ease: "power1.inOut"
        }, "+=0.0");

        this.idleTimeline.to(b.spine.position, {
            y: 0,
            duration: 2.3,
            ease: "power1.inOut"
        }, "<");

        this.idleTimeline.to([b.rightShoulder.position, b.leftShoulder.position], {
            y: "-=0.004",
            duration: 2.3,
            ease: "power1.inOut"
        }, "<");

        this.idleTimeline.to(b.rightElbow.rotation, {
            y: "-=0.015",
            duration: 2.3,
            ease: "power1.inOut"
        }, "<");
        this.idleTimeline.to(b.leftElbow.rotation, {
            y: "+=0.015",
            duration: 2.3,
            ease: "power1.inOut"
        }, "<");
        this.idleTimeline.to([b.rightWrist.rotation, b.leftWrist.rotation], {
            x: "-=0.012",
            duration: 2.3,
            ease: "power1.inOut"
        }, "<");

        // Subtle organic weight shift on hips over 7 seconds
        gsap.to(b.hips.rotation, {
            z: 0.02,
            duration: 3.5,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut"
        });

        gsap.to(b.spine.rotation, {
            z: -0.015,
            duration: 3.5,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut"
        });
    }

    /**
     * Human-Like Waving Gesture:
     * Clavicle raises -> right hand waves at eye level in clear sight -> left hand rests gracefully at waist
     */
    wave() {
        if (!this.isLoaded) {
            this.pendingAction = 'wave';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'wave';
        const b = this.boneMap;
        if (!b.rightArm || !b.rightShoulder) return;

        // Warm, beaming idol smile with happy squint eyes, smiling brows, and cheerful blush
        this.setMorph('笑い', 0.88, 0.25);
        this.setMorph('にっこり', 0.82, 0.25);
        this.setMorph('にこり', 0.60, 0.25);
        this.setMorph('照れ', 0.48, 0.3);
        this.setMorph('口角上げ', 0.65, 0.25);

        const tl = gsap.timeline({
            onComplete: () => this.resetToIdle()
        });

        // 1. Clavicle/shoulder elevation
        tl.to(b.rightShoulder.rotation, {
            z: 0.18,
            y: 0.10,
            duration: 0.3,
            ease: "power2.out"
        }, 0);

        // 2. Spine counter-balance
        tl.to(b.spine.rotation, {
            z: -0.04,
            duration: 0.4,
            ease: "power2.out"
        }, 0);

        // 3. Right arm raises with lively anime bounce
        tl.to(b.rightArm.rotation, {
            z: 0.55,
            x: -0.28,
            y: -0.22,
            duration: 0.48,
            ease: "back.out(1.5)"
        }, 0.08);

        tl.to(b.rightElbow.rotation, {
            x: 1.48,
            y: 0.35,
            z: 0.15,
            duration: 0.48,
            ease: "power2.out"
        }, 0.1);

        // Left hand stays gracefully posed in front of her midriff (both hands visible!)
        tl.to(b.leftArm.rotation, {
            x: 0.14,
            y: 0.14,
            z: 0.98,
            duration: 0.4
        }, 0);
        tl.to(b.leftElbow.rotation, {
            x: 0.35,
            y: -0.82,
            z: -0.08,
            duration: 0.4
        }, 0);
        tl.to(b.leftWrist.rotation, {
            x: 0.20,
            y: -0.16,
            z: -0.24,
            duration: 0.4
        }, 0);

        // 4. Spread fingers gracefully during wave
        this.relaxFingers(this.fingerBones.right, 0.12, 'right');

        // 5. Wave forearm and wrist smoothly 3 times
        tl.to(b.rightWrist.rotation, {
            z: 0.42,
            x: 0.12,
            duration: 0.22,
            repeat: 5,
            yoyo: true,
            ease: "sine.inOut"
        }, 0.25);

        // Head tilts pleasantly towards the gesture
        tl.to(b.head.rotation, {
            z: -0.10,
            x: -0.04,
            duration: 0.4,
            ease: "power1.out"
        }, 0.15);

        // 6. Graceful return to resting companion pose
        tl.to(b.rightShoulder.rotation, {
            z: -0.05,
            y: 0.04,
            duration: 0.7,
            ease: "power2.inOut"
        }, "+=0.2");

        tl.to(b.spine.rotation, {
            z: 0,
            duration: 0.7,
            ease: "power2.inOut"
        }, "<");

        tl.to(b.rightArm.rotation, {
            x: 0.14,
            y: -0.14,
            z: -0.98,
            duration: 0.7,
            ease: "power2.inOut"
        }, "<");

        tl.to(b.rightElbow.rotation, {
            x: 0.35,
            y: 0.82,
            z: 0.08,
            duration: 0.7,
            ease: "power2.out"
        }, "<");

        tl.to(b.rightWrist.rotation, {
            x: 0.20,
            y: 0.16,
            z: 0.24,
            duration: 0.7,
            ease: "power2.out"
        }, "<");

        tl.to(b.head.rotation, {
            z: 0,
            x: 0,
            duration: 0.5,
            ease: "power2.out"
        }, "<");

        this.activeTimeline = tl;
    }

    /**
     * Arms-Crossed Pose (Tsundere Pride):
     * Forearms fold across lower chest, hands rest visibly on sleeves, proud chin lift
     */
    crossArms() {
        if (!this.isLoaded) {
            this.pendingAction = 'crossArms';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'crossArms';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        // Expressive tsundere pride: sassy half-lidded eyes, determined pout brows, slight smirk/blush
        this.setMorph('じと目', 0.65, 0.35);
        this.setMorph('怒り', 0.40, 0.35);
        this.setMorph('ｷﾘｯ', 0.30, 0.35);
        this.setMorph('照れ', 0.35, 0.35);
        this.setMorph('口角上げ', 0.20, 0.3);
        this.setMorph('笑い', 0, 0.2);

        const tl = gsap.timeline();

        // Shoulders pull forward slightly
        tl.to(b.rightShoulder.rotation, { z: 0.08, y: 0.12, duration: 0.5 }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.08, y: -0.12, duration: 0.5 }, 0);

        // Right arm folds across chest (hands prominently visible on outer sleeves!)
        tl.to(b.rightArm.rotation, {
            x: 0.35,
            y: -0.25,
            z: -0.70,
            duration: 0.55,
            ease: "power2.out"
        }, 0);
        tl.to(b.rightElbow.rotation, {
            x: 0.25,
            y: 1.85,
            z: -0.20,
            duration: 0.55,
            ease: "power2.out"
        }, 0);
        tl.to(b.rightWrist.rotation, {
            x: 0.15,
            y: 0.25,
            z: 0.35,
            duration: 0.55
        }, 0);

        // Left arm folds under right
        tl.to(b.leftArm.rotation, {
            x: 0.35,
            y: 0.25,
            z: 0.70,
            duration: 0.55,
            ease: "power2.out"
        }, 0.05);
        tl.to(b.leftElbow.rotation, {
            x: 0.25,
            y: -1.85,
            z: 0.20,
            duration: 0.55,
            ease: "power2.out"
        }, 0.05);
        tl.to(b.leftWrist.rotation, {
            x: 0.15,
            y: -0.25,
            z: -0.35,
            duration: 0.55
        }, 0.05);

        // Curled fingers resting softly on sleeves in clear sight
        this.relaxFingers(this.fingerBones.right, 0.42, 'right');
        this.relaxFingers(this.fingerBones.left, 0.42, 'left');

        // Confident head tilt & slight upward chin
        tl.to(b.head.rotation, {
            x: -0.06,
            y: 0.16,
            z: 0.06,
            duration: 0.5,
            ease: "power1.out"
        }, 0.1);

        this.activeTimeline = tl;
    }

    /**
     * Welcoming Hand-Reach:
     * Body leans forward, arm reaches with open fingers, radiant warm smile & star eyes
     */
    reachHand() {
        if (!this.isLoaded) {
            this.pendingAction = 'reachHand';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'reachHand';
        const b = this.boneMap;
        if (!b.rightArm) return;

        // Sparkling heartfelt eyes, beaming idol smile, rosy flush
        this.setMorph('星目', 0.65, 0.25);
        this.setMorph('笑い', 0.85, 0.25);
        this.setMorph('にっこり', 0.90, 0.25);
        this.setMorph('にこり', 0.55, 0.25);
        this.setMorph('照れ', 0.52, 0.3);

        const tl = gsap.timeline();

        // Torso leans forward towards the viewer
        tl.to(b.spine.position, {
            z: 0.08,
            duration: 0.55,
            ease: "power2.out"
        }, 0);

        tl.to(b.chest.rotation, {
            x: 0.09,
            duration: 0.55,
            ease: "power2.out"
        }, 0);

        // Right arm stretches forward with palm invitingly upturned
        tl.to(b.rightArm.rotation, {
            x: 0.55,
            y: -0.15,
            z: -0.38,
            duration: 0.55,
            ease: "back.out(1.3)"
        }, 0.05);

        tl.to(b.rightElbow.rotation, {
            x: 0.35,
            y: 0.62,
            z: 0.05,
            duration: 0.55,
            ease: "power2.out"
        }, 0.08);

        tl.to(b.rightWrist.rotation, {
            x: -0.20,
            y: 0.18,
            z: 0.22,
            duration: 0.55
        }, 0.08);

        // Welcoming open fingers with soft delicate curvature
        this.relaxFingers(this.fingerBones.right, 0.12, 'right');

        // Left hand remains in elegant rest position in view
        tl.to(b.leftArm.rotation, {
            x: 0.14,
            y: 0.14,
            z: 0.98,
            duration: 0.5
        }, 0);
        tl.to(b.leftElbow.rotation, {
            x: 0.35,
            y: -0.82,
            z: -0.08,
            duration: 0.5
        }, 0);
        tl.to(b.leftWrist.rotation, {
            x: 0.20,
            y: -0.16,
            z: -0.24,
            duration: 0.5
        }, 0);

        // Head tilts affectionately
        tl.to(b.head.rotation, {
            z: -0.10,
            x: -0.04,
            duration: 0.5,
            ease: "power1.out"
        }, 0.1);

        this.activeTimeline = tl;
    }

    /**
     * Bashful Shy / Prayer Pose:
     * Hands clasped near chest, shoulders shrugged, rosy cheeks, gentle bashful bow
     */
    shyPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'shy';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'shy';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        // Vivid bashful blush, softened eyes, bashful smile and flustered brows
        this.setMorph('照れ', 0.98, 0.35);
        this.setMorph('にっこり', 0.60, 0.35);
        this.setMorph('なごみ', 0.45, 0.3);
        this.setMorph('困る', 0.55, 0.35);
        this.setMorph('口角上げ', 0.35, 0.3);
        this.setMorph('ω', 0.30, 0.3);

        const tl = gsap.timeline();

        // Shoulders shrug upward with bashful nervousness
        tl.to(b.rightShoulder.rotation, { z: 0.15, y: 0.08, duration: 0.45 }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.15, y: -0.08, duration: 0.45 }, 0);

        // Both hands brought together right at upper chest in front of tie
        tl.to(b.rightArm.rotation, {
            x: 0.35,
            y: -0.15,
            z: -0.80,
            duration: 0.5,
            ease: "elastic.out(1, 0.75)"
        }, 0);
        tl.to(b.rightElbow.rotation, {
            x: 0.30,
            y: 1.95,
            z: -0.20,
            duration: 0.5,
            ease: "elastic.out(1, 0.75)"
        }, 0);
        tl.to(b.rightWrist.rotation, {
            x: 0.10,
            y: 0.30,
            z: 0.25,
            duration: 0.5
        }, 0);

        tl.to(b.leftArm.rotation, {
            x: 0.35,
            y: 0.15,
            z: 0.80,
            duration: 0.5,
            ease: "elastic.out(1, 0.75)"
        }, 0);
        tl.to(b.leftElbow.rotation, {
            x: 0.30,
            y: -1.95,
            z: 0.20,
            duration: 0.5,
            ease: "elastic.out(1, 0.75)"
        }, 0);
        tl.to(b.leftWrist.rotation, {
            x: 0.10,
            y: -0.30,
            z: -0.25,
            duration: 0.5
        }, 0);

        // Hands clustered delicately together with curled fingers
        this.relaxFingers(this.fingerBones.right, 0.35, 'right');
        this.relaxFingers(this.fingerBones.left, 0.35, 'left');

        // Head shyly bows downward and tilts
        tl.to(b.head.rotation, {
            x: 0.14,
            z: 0.06,
            duration: 0.5,
            ease: "power2.out"
        }, 0.1);

        this.activeTimeline = tl;
    }

    /**
     * Programmatic Head Nod (Agreement) with distributed cervical curve
     */
    nod() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        const b = this.boneMap;
        if (!b.head || !b.neck) return;

        // Friendly beaming smile on nod
        this.setMorph('にっこり', 0.75, 0.2);
        this.setMorph('にこり', 0.55, 0.2);
        this.setMorph('照れ', 0.35, 0.2);
        this.setMorph('笑い', 0.40, 0.2);

        const tl = gsap.timeline({
            onComplete: () => this.resetToIdle()
        });

        // Distribute nod across neck and head
        tl.to(b.neck.rotation, {
            x: 0.08,
            duration: 0.22,
            repeat: 3,
            yoyo: true,
            ease: "sine.inOut"
        }, 0);

        tl.to(b.head.rotation, {
            x: 0.18,
            duration: 0.22,
            repeat: 3,
            yoyo: true,
            ease: "sine.inOut"
        }, 0);

        this.activeTimeline = tl;
    }

    /**
     * Programmatic Head Shake (Disagreement) with distributed neck yaw
     */
    shakeHead() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        const b = this.boneMap;
        if (!b.head || !b.neck) return;

        // Empathetic, worried disagreement expression
        this.setMorph('困る', 0.65, 0.2);
        this.setMorph('じと目', 0.30, 0.2);
        this.setMorph('口角下げ', 0.30, 0.2);
        this.setMorph('照れ', 0.25, 0.2);

        const tl = gsap.timeline({
            onComplete: () => this.resetToIdle()
        });

        tl.to(b.neck.rotation, {
            y: 0.10,
            duration: 0.18,
            repeat: 4,
            yoyo: true,
            ease: "sine.inOut"
        }, 0);

        tl.to(b.head.rotation, {
            y: 0.22,
            duration: 0.18,
            repeat: 4,
            yoyo: true,
            ease: "sine.inOut"
        }, 0);

        this.activeTimeline = tl;
    }

    /**
     * Thinking Pose: Right hand to chin, left hand at waist, inquisitive eyes looking up
     */
    thinkPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'think';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'think';
        const b = this.boneMap;
        if (!b.rightArm || !b.head) return;

        // Pondering expression: inquisitive brows, pursed lips, eye darting up
        this.setMorph('じと目', 0.40, 0.3);
        this.setMorph('困る', 0.35, 0.3);
        this.setMorph('ｷﾘｯ', 0.30, 0.3);
        this.setMorph('う', 0.22, 0.3);
        this.setMorph('口角上げ', 0.15, 0.3);

        const tl = gsap.timeline();

        // Right hand placed near cheek/chin inquisitively
        tl.to(b.rightArm.rotation, {
            x: 0.25,
            y: -0.15,
            z: -0.65,
            duration: 0.5,
            ease: "power2.out"
        }, 0);

        tl.to(b.rightElbow.rotation, {
            x: 1.25,
            y: 1.85,
            z: -0.10,
            duration: 0.5,
            ease: "power2.out"
        }, 0);

        tl.to(b.rightWrist.rotation, {
            x: 0.15,
            y: 0.35,
            z: 0.45,
            duration: 0.5
        }, 0);

        // Left forearm rests comfortably at waist (both hands visible!)
        tl.to(b.leftArm.rotation, {
            x: 0.14,
            y: 0.14,
            z: 0.98,
            duration: 0.5,
            ease: "power2.out"
        }, 0);
        tl.to(b.leftElbow.rotation, {
            x: 0.35,
            y: -0.82,
            z: -0.08,
            duration: 0.5,
            ease: "power2.out"
        }, 0);
        tl.to(b.leftWrist.rotation, {
            x: 0.20,
            y: -0.16,
            z: -0.24,
            duration: 0.5,
            ease: "power2.out"
        }, 0);

        // Index and thumb gently framing chin, fingers curled
        this.relaxFingers(this.fingerBones.right, 0.38, 'right');
        this.relaxFingers(this.fingerBones.left, 0.32, 'left');

        // Head looking up and slightly tilted
        tl.to(b.head.rotation, {
            x: -0.06,
            y: 0.14,
            z: 0.05,
            duration: 0.5,
            ease: "power2.out"
        }, 0.05);

        this.activeTimeline = tl;
    }

    /**
     * Pout Pose (Tsundere turn): Hands on hips akimbo, head turned away with adorable pout
     */
    poutPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'pout';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'pout';
        const b = this.boneMap;
        if (!b.head || !b.rightArm || !b.leftArm) return;

        // Signature anime pout: furrowed brow, narrowed eyes, downturned mouth, flushed cheeks
        this.setMorph('怒り', 0.75, 0.3);
        this.setMorph('じと目', 0.55, 0.3);
        this.setMorph('口角下げ', 0.35, 0.3);
        this.setMorph('照れ', 0.50, 0.3);
        this.setMorph('う', 0.25, 0.3);

        const tl = gsap.timeline();

        // Hands placed akimbo on hips! (Classic defiant anime stance - hands fully visible)
        tl.to(b.rightArm.rotation, {
            x: 0.15,
            y: -0.20,
            z: -0.95,
            duration: 0.45,
            ease: "power2.out"
        }, 0);
        tl.to(b.rightElbow.rotation, {
            x: 0.45,
            y: 1.15,
            z: 0.15,
            duration: 0.45
        }, 0);
        tl.to(b.rightWrist.rotation, {
            x: 0.25,
            y: 0.20,
            z: 0.30,
            duration: 0.45
        }, 0);

        tl.to(b.leftArm.rotation, {
            x: 0.15,
            y: 0.20,
            z: 0.95,
            duration: 0.45,
            ease: "power2.out"
        }, 0);
        tl.to(b.leftElbow.rotation, {
            x: 0.45,
            y: -1.15,
            z: -0.15,
            duration: 0.45
        }, 0);
        tl.to(b.leftWrist.rotation, {
            x: 0.25,
            y: -0.20,
            z: -0.30,
            duration: 0.45
        }, 0);

        this.relaxFingers(this.fingerBones.right, 0.42, 'right');
        this.relaxFingers(this.fingerBones.left, 0.42, 'left');

        // Head turns away sharply with sassy tilt
        tl.to(b.head.rotation, {
            y: -0.28,
            z: -0.08,
            x: 0.04,
            duration: 0.45,
            ease: "back.out(1.2)"
        }, 0);

        this.activeTimeline = tl;
    }

    /**
     * Playful Anime Wink with living cheek squeeze & cute hand wave
     */
    wink() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        this.currentAction = 'wink';
        const b = this.boneMap;

        // Playful wink with starry highlights, beaming smile & rosy cheeks
        this.setMorph('ウィンク', 1.0, 0.12);
        this.setMorph('笑い', 0.45, 0.12);
        this.setMorph('照れ', 0.60, 0.15);
        this.setMorph('口角上げ', 0.75, 0.15);
        this.setMorph('星目', 0.40, 0.15);
        this.setMorph('にこり', 0.50, 0.15);

        const tl = gsap.timeline({
            onComplete: () => this.resetToIdle()
        });

        // Cute hand salute / cheek touch
        if (b.rightArm && b.rightElbow) {
            tl.to(b.rightArm.rotation, {
                x: 0.05,
                y: -0.35,
                z: -0.10,
                duration: 0.35,
                ease: "back.out(1.4)"
            }, 0);
            tl.to(b.rightElbow.rotation, {
                x: 1.75,
                y: 1.15,
                z: -0.15,
                duration: 0.35
            }, 0);
            tl.to(b.rightWrist.rotation, {
                x: 0.15,
                y: 0.20,
                z: 0.25,
                duration: 0.35
            }, 0);
            this.relaxFingers(this.fingerBones.right, 0.22, 'right');
        }

        if (b.leftArm && b.leftElbow) {
            tl.to(b.leftArm.rotation, {
                x: 0.14,
                y: 0.14,
                z: 0.98,
                duration: 0.35
            }, 0);
            tl.to(b.leftElbow.rotation, {
                x: 0.35,
                y: -0.82,
                z: -0.08,
                duration: 0.35
            }, 0);
            tl.to(b.leftWrist.rotation, {
                x: 0.20,
                y: -0.16,
                z: -0.24,
                duration: 0.35
            }, 0);
            this.relaxFingers(this.fingerBones.left, 0.32, 'left');
        }

        // Playful head cant
        if (b.head) {
            tl.to(b.head.rotation, {
                z: 0.12,
                x: -0.05,
                duration: 0.35,
                ease: "power2.out"
            }, 0);
        }

        // Return to idle
        tl.to({}, { duration: 1.2 });
        this.activeTimeline = tl;
    }

    /**
     * Joyful Celebration / Cheer Pose:
     * Raises both hands with excitement, starry eyes, radiant smile, and lively bouncing!
     */
    cheer() {
        if (!this.isLoaded) {
            this.pendingAction = 'cheer';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'cheer';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        // Radiant idol celebration: star eyes, maximum beaming smile, rosy cheeks
        this.setMorph('星目', 0.85, 0.25);
        this.setMorph('笑い', 0.85, 0.25);
        this.setMorph('にっこり', 0.95, 0.25);
        this.setMorph('口角上げ', 0.80, 0.25);
        this.setMorph('照れ', 0.65, 0.3);
        this.setMorph('にこり', 0.70, 0.25);

        const tl = gsap.timeline({
            onComplete: () => this.resetToIdle()
        });

        // Both shoulders raise
        tl.to(b.rightShoulder.rotation, { z: 0.20, duration: 0.35 }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.20, duration: 0.35 }, 0);

        // Both arms pump up enthusiastically (both hands prominently visible in air!)
        tl.to(b.rightArm.rotation, {
            z: 0.65,
            x: -0.15,
            y: -0.25,
            duration: 0.45,
            ease: "back.out(1.8)"
        }, 0.05);
        tl.to(b.rightElbow.rotation, {
            x: 1.65,
            y: 0.35,
            duration: 0.45
        }, 0.05);

        tl.to(b.leftArm.rotation, {
            z: -0.65,
            x: -0.15,
            y: 0.25,
            duration: 0.45,
            ease: "back.out(1.8)"
        }, 0.05);
        tl.to(b.leftElbow.rotation, {
            x: 1.65,
            y: -0.35,
            duration: 0.45
        }, 0.05);

        // Cheerful open hands
        this.relaxFingers(this.fingerBones.right, 0.15, 'right');
        this.relaxFingers(this.fingerBones.left, 0.15, 'left');

        // Bouncing jump / cheer rhythm on spine
        tl.to(b.spine.position, {
            y: 0.035,
            duration: 0.18,
            repeat: 5,
            yoyo: true,
            ease: "sine.inOut"
        }, 0.1);

        tl.to(b.head.rotation, {
            x: -0.10,
            duration: 0.35,
            ease: "power2.out"
        }, 0.05);

        tl.to({}, { duration: 1.5 });
        this.activeTimeline = tl;
    }

    setAction(actionName) {
        if (!this.isLoaded) {
            this.pendingAction = actionName;
            return;
        }
        switch (actionName) {
            case 'wave':        this.wave(); break;
            case 'cross_arms':
            case 'crossArms':   this.crossArms(); break;
            case 'reach':
            case 'reachHand':   this.reachHand(); break;
            case 'shy':         this.shyPose(); break;
            case 'nod':         this.nod(); break;
            case 'shake_head':
            case 'shakeHead':   this.shakeHead(); break;
            case 'think':       this.thinkPose(); break;
            case 'pout':        this.poutPose(); break;
            case 'wink':        this.wink(); break;
            case 'cheer':
            case 'celebrate':   this.cheer(); break;
            case 'idle':
            default:            this.resetToIdle(); break;
        }
    }

    resetToIdle() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        this.currentAction = 'idle';

        this.setMorph('笑い', 0, 0.4);
        this.setMorph('にっこり', 0, 0.4);
        this.setMorph('にこり', 0, 0.4);
        this.setMorph('照れ', 0.14, 0.4); // Maintain soft anime blush
        this.setMorph('怒り', 0, 0.4);
        this.setMorph('じと目', 0, 0.4);
        this.setMorph('困る', 0, 0.4);
        this.setMorph('口角上げ', 0.10, 0.4); // Subtle friendly smile
        this.setMorph('口角下げ', 0, 0.4);
        this.setMorph('星目', 0, 0.4);
        this.setMorph('はぁと', 0, 0.4);
        this.setMorph('てへぺろ', 0, 0.4);
        this.setMorph('ｷﾘｯ', 0, 0.4);
        this.setMorph('なごみ', 0, 0.4);
        this.setMorph('う', 0, 0.4);
        this.setMorph('お', 0, 0.4);
        this.setMorph('い', 0, 0.4);
        this.setMorph('あ', 0, 0.4);

        this.setRestPose();
    }

    /**
     * Dynamic Multi-Phoneme Co-articulation Lip-Sync:
     * Blends 5 vowels ('あ', 'い', 'う', 'え', 'お') with smile lift, brow accents,
     * and speech cadence oscillation so speaking looks vividly alive in any language!
     */
    setMouthOpenness(val) {
        if (!this.isLoaded) return;
        const openness = Math.max(0, Math.min(1, val));

        if (openness > 0.04) {
            const time = performance.now() * 0.012;
            const cycle = Math.sin(time);
            const cycleCos = Math.cos(time * 0.82);

            // Dynamic vowel distribution across Ah, Ii, Oo, Uu based on acoustic phase
            const vowelA = openness * (0.55 + 0.35 * Math.max(0, cycle));
            const vowelI = openness * (0.28 + 0.32 * Math.max(0, cycleCos));
            const vowelO = openness * (0.20 + 0.35 * Math.max(0, -cycle));
            const vowelU = openness * (0.15 + 0.25 * Math.max(0, -cycleCos));

            // Cheerful smile corner lift while talking
            const smile = 0.16 + (openness * 0.34);
            // Expressive eyebrow bounce on syllable emphasis
            const browLift = openness > 0.45 ? (openness - 0.45) * 0.45 : 0.08;
            // Subtle sympathetic eyelid squint on louder vocal syllables
            const eyeSquint = openness > 0.65 ? (openness - 0.65) * 0.25 : 0;

            this.setMorph('あ', vowelA, 0.04);
            this.setMorph('い', vowelI, 0.04);
            this.setMorph('お', vowelO, 0.04);
            this.setMorph('う', vowelU, 0.04);
            this.setMorph('口角上げ', smile, 0.05);
            this.setMorph('にこり', browLift, 0.06);
            if (eyeSquint > 0) this.setMorph('笑い', eyeSquint, 0.06);
        } else {
            this.setMorph('あ', 0, 0.08);
            this.setMorph('い', 0, 0.08);
            this.setMorph('お', 0, 0.08);
            this.setMorph('う', 0, 0.08);
            this.setMorph('口角上げ', 0.10, 0.12);
            this.setMorph('にこり', 0, 0.12);
            this.setMorph('笑い', 0, 0.12);
        }
    }

    // =========================================================================
    // INERTIAL HAIR PHYSICS, LIVING SACCADES & RENDER LOOP
    // =========================================================================

    startRenderLoop() {
        const render = () => {
            const dt = this.clock.getDelta();
            const elapsed = this.clock.getElapsedTime();

            if (this.controls) {
                this.controls.update();
            }

            this.updateLivingGazeAndSaccades(elapsed);
            this.updateHairPhysics(dt);
            this.updateParticles(elapsed);

            this.renderer.render(this.scene, this.camera);
            requestAnimationFrame(render);
        };
        render();
    }

    /**
     * Living Human Gaze: Distributed spinal rotation + Saccadic eye micro-darts
     */
    updateLivingGazeAndSaccades(t) {
        if (!this.isLoaded || !this.boneMap || !this.boneMap.head) return;

        // 1. Living Eye Saccades (Rapid tiny eye jumps between focus points every 1.5 - 3.2s)
        if (t - this.lastSaccadeTime > this.saccadeInterval) {
            this.lastSaccadeTime = t;
            this.saccadeInterval = 1.4 + Math.random() * 2.2;
            this.saccade.x = (Math.random() - 0.5) * 0.07;
            this.saccade.y = (Math.random() - 0.5) * 0.05;
        }

        // 2. Smooth Mouse Target Tracking
        const targetX = this.mouse.x * 0.36;
        const targetY = -this.mouse.y * 0.24;

        this.gaze.x += (targetX - this.gaze.x) * 0.075;
        this.gaze.y += (targetY - this.gaze.y) * 0.075;

        // 3. Eyeballs Lead First (Saccade + Gaze)
        const eyeBone = this.boneMap.eyes || this.boneMap.rightEye;
        if (eyeBone) {
            eyeBone.rotation.y = (this.gaze.x * 0.5) + this.saccade.x;
            eyeBone.rotation.x = (this.gaze.y * 0.4) + this.saccade.y;
        }
        if (this.boneMap.leftEye && this.boneMap.rightEye) {
            this.boneMap.leftEye.rotation.y = (this.gaze.x * 0.5) + this.saccade.x;
            this.boneMap.leftEye.rotation.x = (this.gaze.y * 0.4) + this.saccade.y;
            this.boneMap.rightEye.rotation.y = (this.gaze.x * 0.5) + this.saccade.x;
            this.boneMap.rightEye.rotation.x = (this.gaze.y * 0.4) + this.saccade.y;
        }

        // 4. Distributed Cervical Spine Rotation (Organic head turn without robotic neck stiffness)
        if (!this.activeTimeline) {
            const b = this.boneMap;
            // Chest absorbs 18% of rotation
            if (b.chest) {
                b.chest.rotation.y = this.gaze.x * 0.18;
            }
            // Neck absorbs 28% of rotation
            if (b.neck) {
                b.neck.rotation.y = this.gaze.x * 0.28;
                b.neck.rotation.x = this.gaze.y * 0.28;
            }
            // Head absorbs remaining 54%
            if (b.head) {
                b.head.rotation.y = this.gaze.x * 0.54;
                b.head.rotation.x = this.gaze.y * 0.54;
            }
        }
    }

    /**
     * Inertial spring physics for long twintails (Multi-segment lag and momentum)
     */
    updateHairPhysics(dt) {
        if (!this.isLoaded || !this.boneMap || !this.boneMap.head) return;

        const hp = this.hairPhysics;
        const headRotY = this.boneMap.head.rotation.y;
        const headRotX = this.boneMap.head.rotation.x;

        const count = Math.min(this.hairLeft.length, 7);

        for (let i = 0; i < count; i++) {
            const stiffness = 20.0 - i * 2.4;
            const damping = 0.86;

            const targetZ = -headRotY * (0.24 + i * 0.12);
            const targetX = -headRotX * (0.18 + i * 0.08);

            // Left twintail bone
            const forceL = (targetZ - hp.leftChain[i]) * stiffness;
            hp.leftVel[i] = (hp.leftVel[i] + forceL * dt) * damping;
            hp.leftChain[i] += hp.leftVel[i] * dt;

            if (this.hairLeft[i]) {
                this.hairLeft[i].rotation.z = hp.leftChain[i];
                this.hairLeft[i].rotation.x = targetX;
            }

            // Right twintail bone
            const forceR = (-targetZ - hp.rightChain[i]) * stiffness;
            hp.rightVel[i] = (hp.rightVel[i] + forceR * dt) * damping;
            hp.rightChain[i] += hp.rightVel[i] * dt;

            if (this.hairRight[i]) {
                this.hairRight[i].rotation.z = -hp.rightChain[i];
                this.hairRight[i].rotation.x = targetX;
            }
        }
    }

    updateParticles(t) {
        if (!this.particles) return;
        const pos = this.particles.geometry.attributes.position.array;
        for (let i = 0; i < pos.length / 3; i++) {
            pos[i * 3 + 1] += Math.sin(t * 1.5 + i) * 0.0012;
            pos[i * 3] += Math.cos(t * 1.0 + i) * 0.0008;
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * Organic Eyelid Blinking with gentle micro-nod coordination
     */
    startBlinkScheduler() {
        const schedule = () => {
            const delay = 2400 + Math.random() * 3200;
            setTimeout(() => {
                if (this.isLoaded) {
                    // Natural human blink: down fast (80ms), open smooth (120ms)
                    this.setMorph('まばたき', 1.0, 0.08);
                    setTimeout(() => {
                        this.setMorph('まばたき', 0.0, 0.12);
                        // 22% chance of an authentic double-blink
                        if (Math.random() < 0.22) {
                            setTimeout(() => {
                                this.setMorph('まばたき', 1.0, 0.07);
                                setTimeout(() => this.setMorph('まばたき', 0.0, 0.10), 80);
                            }, 110);
                        }
                    }, 100);
                }
                schedule();
            }, delay);
        };
        schedule();
    }
}
