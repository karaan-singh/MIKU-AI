/**
 * Miku3D: Ultra-Realistic Human Behavioral Biomechanics, 63-Morph FACS & Secondary Physics Engine
 *
 * Grounded in Human Behavioral & Cognitive Science:
 * - Ekman FACS Facial Action Units across all 63 native Miku4.vrm morph targets:
 *   Eyebrow flashes ('上'), asymmetrical inner-brow curiosity ('眉頭左'/'右'), Duchenne eye crinkles ('笑い'),
 *   pupil dilation/contraction ('瞳小'), empathetic softening ('困る', 'なごみ', 'はぅ'), natural smirks ('にやり').
 * - 6-Viseme + Bilabial ('ん' /m,b,p/) Speech Co-Articulation:
 *   True vowel shaping ('あ','い','う','え','お') + full lip closure on bilabials + lateral stretch ('口横広げ').
 * - Kendon 4-Phase Conversational Hand Beats & Axial Forearm Supination ('右腕捩', '左腕捩'):
 *   Natural palm-up conversational beat gestures, empathetic heart-touch, genuine 3-beat laughter, startle pullback.
 * - Ocular & Turn-Taking Neuroscience:
 *   70% mutual eye contact + saccades, cognitive upward-lateral gaze shift when thinking, saccade-linked blinks,
 *   active listening forward lean + ear-cant + periodic backchannel micro-nods.
 * - Full Secondary Spring-Damper Physics:
 *   9-segment twintails ('左髪1..9','右髪1..9'), 3-segment cyan necktie ('ﾈｸﾀｲ1..3'), front bangs ('前髪1..3'),
 *   sideburns ('もみあげ'), and ahoge ('アホ毛1..2').
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
        this.necktieBones = [];
        this.bangsBones = [];
        this.sideburnBones = [];
        this.ahogeBones = [];
        this.fingerBones = { right: [], left: [] };

        // GSAP Timelines & Timers
        this.activeTimeline = null;
        this.idleTimeline = null;
        this.pendingAction = null;
        this.backchannelTimer = null;
        this.livingExpressionTimeout = null;

        // Human Behavioral State
        this.isLoaded = false;
        this.currentAction = 'idle';
        this.gazeMode = 'mutual'; // 'mutual' | 'listening' | 'thinking' | 'shy'
        this.isSpeakingNow = false;
        this.inferenceThrottle = false;
        this.frameTick = 0;
        this.lastBeatTime = 0;
        this.clock = new THREE.Clock();

        // Eye Saccades, Webcam Viewer Gaze, Cognitive Gaze & Blink Coupling
        this.mouse = { x: 0, y: 0 };
        this.webcamGaze = { x: 0, y: 0, active: false };
        this.gaze = { x: 0, y: 0 };
        this.prevEyeTarget = { x: 0, y: 0 };
        this.saccade = { x: 0, y: 0 };
        this.cognitiveOffset = { x: 0, y: 0 };
        this.lastSaccadeTime = 0;
        this.saccadeInterval = 2.0;
        this.lastBlinkTime = 0;

        // Additive 60 FPS Human Respiratory Layer (keeps breathing organically across ALL held poses!)
        this.additiveBreath = { prevChest: 0, prevShoulder: 0 };

        // Multi-chain Inertial Spring Physics (Twintails, Necktie, Bangs, Ahoge)
        this.hairPhysics = {
            leftChain: new Array(9).fill(0),
            leftVel: new Array(9).fill(0),
            rightChain: new Array(9).fill(0),
            rightVel: new Array(9).fill(0),
            tieChainX: new Array(3).fill(0),
            tieVelX: new Array(3).fill(0),
            tieChainZ: new Array(3).fill(0),
            tieVelZ: new Array(3).fill(0),
            bangsX: 0,
            bangsVel: 0,
            ahogeZ: 0,
            ahogeVel: 0,
            prevSpineY: 0
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

        // 36° portrait lens: frames head, expressive face, shoulders, torso, necktie, and both hands clearly
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

        // 5-Point Studio Portrait Lighting
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

        const fillLight = new THREE.DirectionalLight(0xe8f8ff, 0.45);
        fillLight.position.set(0, -0.6, 2.0);
        this.scene.add(fillLight);

        window.addEventListener('resize', () => this.handleResize());
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.handleResize());
            this.resizeObserver.observe(this.container);
        }

        window.addEventListener('mousemove', (e) => {
            const rect = this.container.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            this.mouse.x = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
            this.mouse.y = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
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

                // Extract VRM 0.x primitive.extras.targetNames (Three.js GLTFLoader only checks mesh.extras.targetNames!)
                let vrmTargetNames = null;
                const gltfMeshes = gltf.parser?.json?.meshes || [];
                for (const mDef of gltfMeshes) {
                    if (mDef.extras?.targetNames?.length) {
                        vrmTargetNames = mDef.extras.targetNames;
                        break;
                    }
                    for (const pDef of (mDef.primitives || [])) {
                        if (pDef.extras?.targetNames?.length) {
                            vrmTargetNames = pDef.extras.targetNames;
                            break;
                        }
                    }
                    if (vrmTargetNames) break;
                }

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
                        if (child.morphTargetInfluences && !child.morphTargetDictionary) {
                            child.morphTargetDictionary = {};
                        }
                        if (child.morphTargetDictionary && child.morphTargetInfluences) {
                            const namesList = child.geometry?.userData?.targetNames || vrmTargetNames;
                            if (Array.isArray(namesList)) {
                                namesList.forEach((tName, tIdx) => {
                                    if (tIdx < child.morphTargetInfluences.length) {
                                        child.morphTargetDictionary[tName] = tIdx;
                                    }
                                });
                            }
                            Object.assign(this.morphNames, child.morphTargetDictionary);
                        }
                    }

                    if (child.isBone || child.type === 'Bone') {
                        const name = child.name;
                        this.bones[name] = child;
                        this.defaultRotations[name] = child.rotation.clone();
                    }
                });

                // Complete Humanoid Skeletal Bone Map (including axial arm/hand twist & groove!)
                this.boneMap = {
                    groove: this.bones['グルーブ'],
                    hips: this.bones['腰'],
                    spine: this.bones['上半身'],
                    chest: this.bones['上半身2'],
                    neck: this.bones['首'],
                    head: this.bones['頭'],
                    eyes: this.bones['両目'] || this.bones['右目'],
                    leftEye: this.bones['左目'],
                    rightEye: this.bones['右目'],
                    rightShoulder: this.bones['右肩'],
                    rightArm: this.bones['右腕'],
                    rightArmTwist: this.bones['右腕捩'],
                    rightElbow: this.bones['右ひじ'],
                    rightHandTwist: this.bones['右手捩'],
                    rightWrist: this.bones['右手首'],
                    leftShoulder: this.bones['左肩'],
                    leftArm: this.bones['左腕'],
                    leftArmTwist: this.bones['左腕捩'],
                    leftElbow: this.bones['左ひじ'],
                    leftHandTwist: this.bones['左手捩'],
                    leftWrist: this.bones['左手首']
                };

                // 3-joint finger chains across all 10 fingers
                this.fingerBones = { right: [], left: [] };
                ['人指', '中指', '薬指', '小指', '親指'].forEach((finger) => {
                    for (let j = 1; j <= 3; j++) {
                        if (this.bones[`右${finger}${j}`]) this.fingerBones.right.push(this.bones[`右${finger}${j}`]);
                        if (this.bones[`左${finger}${j}`]) this.fingerBones.left.push(this.bones[`左${finger}${j}`]);
                    }
                });

                // Full 9-link twintail chains ('左髪１'..'左髪９' using full-width digits in Miku4.vrm!)
                const fwDigits = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];
                this.hairLeft = [];
                this.hairRight = [];
                for (let i = 0; i < 9; i++) {
                    const lb = this.bones[`左髪${fwDigits[i]}`] || this.bones[`左髪${i + 1}`];
                    const rb = this.bones[`右髪${fwDigits[i]}`] || this.bones[`右髪${i + 1}`];
                    if (lb) this.hairLeft.push(lb);
                    if (rb) this.hairRight.push(rb);
                }

                // Secondary soft-body/accessory chains: Cyan Necktie, Front Bangs, Sideburns, Ahoge!
                this.necktieBones = ['ﾈｸﾀｲ１', 'ﾈｸﾀｲ２', 'ﾈｸﾀｲ３'].map(n => this.bones[n]).filter(Boolean);
                this.bangsBones = ['前髪１', '前髪２', '前髪３'].map(n => this.bones[n]).filter(Boolean);
                this.sideburnBones = ['右もみあげ１', '右もみあげ２', '左もみあげ１', '左もみあげ２'].map(n => this.bones[n]).filter(Boolean);
                this.ahogeBones = ['アホ毛１', 'アホ毛２'].map(n => this.bones[n]).filter(Boolean);

                // Face directly towards viewer
                this.model.rotation.y = Math.PI;
                this.scene.add(this.model);
                this.isLoaded = true;

                if (spinner) {
                    if (window.gsap) {
                        gsap.to(spinner, {
                            opacity: 0,
                            duration: 0.45,
                            onComplete: () => { spinner.style.display = 'none'; }
                        });
                    } else {
                        spinner.style.display = 'none';
                    }
                }

                this.setRestPose();
                this.startBlinkScheduler();
                this.startLivingExpressionsLoop();
                this.startIdleMotion();

                if (this.pendingAction) {
                    this.setAction(this.pendingAction);
                    this.pendingAction = null;
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
     * Natural resting human posture with forearms gracefully angled in view and axial twist relaxed
     */
    setRestPose() {
        if (!this.isLoaded || !this.boneMap) return;
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        gsap.to(b.rightShoulder.rotation, { z: -0.05, y: 0.04, x: 0, duration: 0.75 });
        gsap.to(b.leftShoulder.rotation, { z: 0.05, y: -0.04, x: 0, duration: 0.75 });

        if (b.rightArmTwist) gsap.to(b.rightArmTwist.rotation, { x: 0, y: 0, z: 0, duration: 0.7 });
        if (b.leftArmTwist) gsap.to(b.leftArmTwist.rotation, { x: 0, y: 0, z: 0, duration: 0.7 });
        if (b.spine) gsap.to(b.spine.position, { z: 0, duration: 0.7 });
        if (b.chest) gsap.to(b.chest.rotation, { z: 0, duration: 0.7 });

        gsap.to(b.rightArm.rotation, { x: 0.14, y: -0.14, z: -0.98, duration: 0.8, ease: "power2.out" });
        gsap.to(b.rightElbow.rotation, { x: 0.35, y: 0.82, z: 0.08, duration: 0.8, ease: "power2.out" });
        gsap.to(b.rightWrist.rotation, { x: 0.20, y: 0.16, z: 0.24, duration: 0.8, ease: "power2.out" });

        gsap.to(b.leftArm.rotation, { x: 0.14, y: 0.14, z: 0.98, duration: 0.8, ease: "power2.out" });
        gsap.to(b.leftElbow.rotation, { x: 0.35, y: -0.82, z: -0.08, duration: 0.8, ease: "power2.out" });
        gsap.to(b.leftWrist.rotation, { x: 0.20, y: -0.16, z: -0.24, duration: 0.8, ease: "power2.out" });

        this.relaxFingers(this.fingerBones.right, 0.32, 'right');
        this.relaxFingers(this.fingerBones.left, 0.32, 'left');

        if (this.idleTimeline && this.idleTimeline.paused()) {
            this.idleTimeline.resume();
        }
    }

    /**
     * Anatomically graded finger curvature (index softer -> pinky tighter, natural splay + thumb opposition)
     */
    relaxFingers(boneArray, amount = 0.28, handSide = 'right') {
        if (!boneArray || !boneArray.length) return;
        const sideSign = handSide === 'right' ? 1 : -1;

        boneArray.forEach((joint, idx) => {
            const fingerIndex = Math.floor(idx / 3);
            const jointIndex = idx % 3;

            let curlFactor = 1.0;
            let splayZ = 0;

            if (fingerIndex === 0) {
                curlFactor = jointIndex === 0 ? 0.65 : 0.75;
                if (jointIndex === 0) splayZ = 0.05 * sideSign;
            } else if (fingerIndex === 1) {
                curlFactor = jointIndex === 0 ? 0.85 : 0.95;
            } else if (fingerIndex === 2) {
                curlFactor = jointIndex === 0 ? 1.05 : 1.15;
                if (jointIndex === 0) splayZ = -0.04 * sideSign;
            } else if (fingerIndex === 3) {
                curlFactor = jointIndex === 0 ? 1.20 : 1.30;
                if (jointIndex === 0) splayZ = -0.09 * sideSign;
            } else if (fingerIndex === 4) {
                curlFactor = jointIndex === 0 ? 0.45 : (jointIndex === 1 ? 0.55 : 0.65);
                if (jointIndex === 0) splayZ = -0.15 * sideSign;
            }

            gsap.to(joint.rotation, {
                x: amount * curlFactor,
                z: splayZ,
                duration: 0.6,
                ease: "power1.out",
                overwrite: "auto"
            });
        });
    }

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

    /**
     * Reset non-speech emotional FACS morphs cleanly before transitioning to a new emotion
     */
    clearEmotionalMorphs(duration = 0.28) {
        const emotionalMorphs = [
            '笑い', 'にっこり', 'にこり', '怒り', 'じと目', '困る', '真面目',
            'びっくり', 'はぅ', 'なごみ', 'ｷﾘｯ', 'にやり', 'にやり２',
            '星目', 'はぁと', 'てへぺろ', 'ワ', 'ω', '瞳小',
            '上', '下', '眉頭左', '眉頭右', '口角下げ', 'ウィンク', 'ウィンク右'
        ];
        emotionalMorphs.forEach(m => this.setMorph(m, 0, duration));
        this.setMorph('照れ', 0.12, duration);
        this.setMorph('口角上げ', 0.10, duration);
    }

    killActiveTimeline() {
        if (this.backchannelTimer) {
            clearInterval(this.backchannelTimer);
            this.backchannelTimer = null;
        }
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
                b.rightArm?.rotation, b.rightElbow?.rotation, b.rightWrist?.rotation, b.rightArmTwist?.rotation,
                b.leftArm?.rotation, b.leftElbow?.rotation, b.leftWrist?.rotation, b.leftArmTwist?.rotation,
                b.rightShoulder?.rotation, b.leftShoulder?.rotation,
                b.head?.rotation, b.neck?.rotation, b.spine?.rotation, b.chest?.rotation,
                b.spine?.position
            ].filter(Boolean));
        }
    }

    // =========================================================================
    // LIVING HUMAN PRESENCE: MICRO-EXPRESSIONS, BREATHING & BLINK COUPLING
    // =========================================================================

    triggerNaturalBlink(doubleChance = 0.18) {
        if (!this.isLoaded) return;
        const now = performance.now();
        if (now - this.lastBlinkTime < 350) return; // Refractory period
        this.lastBlinkTime = now;

        this.setMorph('まばたき', 1.0, 0.065);
        setTimeout(() => {
            this.setMorph('まばたき', 0.0, 0.11);
            if (Math.random() < doubleChance) {
                setTimeout(() => {
                    this.setMorph('まばたき', 1.0, 0.06);
                    setTimeout(() => this.setMorph('まばたき', 0.0, 0.095), 70);
                }, 105);
            }
        }, 85);
    }

    startBlinkScheduler() {
        const schedule = () => {
            const delay = 2200 + Math.random() * 3200;
            setTimeout(() => {
                if (this.isLoaded && this.currentAction !== 'wink') {
                    this.triggerNaturalBlink(0.22);
                }
                schedule();
            }, delay);
        };
        schedule();
    }

    /**
     * Subtle FACS Micro-Expressions while idle (asymmetrical inner-brow curiosity, warm smiles, gentle daydreams)
     */
    startLivingExpressionsLoop() {
        const triggerMicroExpression = () => {
            const nextDelay = 3200 + Math.random() * 3400;
            this.livingExpressionTimeout = setTimeout(() => {
                if (this.isLoaded && this.currentAction === 'idle' && !this.isSpeakingNow) {
                    const roll = Math.random();
                    if (roll < 0.30) {
                        // 1. Genuine warm Duchenne micro-smile (AU6 + AU12)
                        this.setMorph('にっこり', 0.32, 0.45);
                        this.setMorph('口角上げ', 0.38, 0.45);
                        this.setMorph('照れ', 0.26, 0.5);
                        setTimeout(() => {
                            if (this.currentAction === 'idle' && !this.isSpeakingNow) {
                                this.setMorph('にっこり', 0, 0.65);
                                this.setMorph('口角上げ', 0.10, 0.65);
                                this.setMorph('照れ', 0.12, 0.65);
                            }
                        }, 2100);
                    } else if (roll < 0.58) {
                        // 2. Asymmetrical Human Curiosity (single inner brow lift '眉頭左' + soft gaze)
                        this.setMorph('眉頭左', 0.38, 0.35);
                        this.setMorph('上', 0.18, 0.35);
                        this.setMorph('なごみ', 0.22, 0.4);
                        setTimeout(() => {
                            if (this.currentAction === 'idle' && !this.isSpeakingNow) {
                                this.setMorph('眉頭左', 0, 0.55);
                                this.setMorph('上', 0, 0.55);
                                this.setMorph('なごみ', 0, 0.55);
                            }
                        }, 1800);
                    } else if (roll < 0.82) {
                        // 3. Playful subtle human smirk ('にやり' + warm eye glint)
                        this.setMorph('にやり', 0.32, 0.35);
                        this.setMorph('ｷﾘｯ', 0.22, 0.35);
                        setTimeout(() => {
                            if (this.currentAction === 'idle' && !this.isSpeakingNow) {
                                this.setMorph('にやり', 0, 0.5);
                                this.setMorph('ｷﾘｯ', 0, 0.5);
                            }
                        }, 1700);
                    } else {
                        // 4. Gentle empathetic breath & soft blink
                        this.setMorph('上', 0.22, 0.4);
                        this.setMorph('あ', 0.07, 0.4);
                        setTimeout(() => {
                            if (this.currentAction === 'idle' && !this.isSpeakingNow) {
                                this.setMorph('上', 0, 0.5);
                                this.setMorph('あ', 0, 0.5);
                            }
                        }, 1400);
                    }
                }
                triggerMicroExpression();
            }, nextDelay);
        };
        triggerMicroExpression();
    }

    /**
     * Asymmetrical Human Respiratory Cycle (1.65s inhale -> 0.25s pause -> 2.35s exhale + hip weight sway)
     */
    startIdleMotion() {
        if (!this.isLoaded || !this.boneMap) return;
        if (this.idleTimeline) this.idleTimeline.kill();

        const b = this.boneMap;
        if (!b.chest || !b.spine || !b.hips) return;

        this.idleTimeline = gsap.timeline({ repeat: -1 });

        this.idleTimeline.to(b.chest.rotation, { x: 0.036, duration: 1.65, ease: "sine.inOut" }, 0);
        this.idleTimeline.to(b.spine.position, { y: 0.011, duration: 1.65, ease: "sine.inOut" }, 0);
        this.idleTimeline.to([b.rightShoulder.position, b.leftShoulder.position], { y: "+=0.0038", duration: 1.65, ease: "sine.inOut" }, 0);
        this.idleTimeline.to(b.rightElbow.rotation, { y: "+=0.014", duration: 1.65, ease: "sine.inOut" }, 0);
        this.idleTimeline.to(b.leftElbow.rotation, { y: "-=0.014", duration: 1.65, ease: "sine.inOut" }, 0);

        this.idleTimeline.to({}, { duration: 0.25 });

        this.idleTimeline.to(b.chest.rotation, { x: -0.008, duration: 2.35, ease: "power1.inOut" }, "+=0.0");
        this.idleTimeline.to(b.spine.position, { y: 0, duration: 2.35, ease: "power1.inOut" }, "<");
        this.idleTimeline.to([b.rightShoulder.position, b.leftShoulder.position], { y: "-=0.0038", duration: 2.35, ease: "power1.inOut" }, "<");
        this.idleTimeline.to(b.rightElbow.rotation, { y: "-=0.014", duration: 2.35, ease: "power1.inOut" }, "<");
        this.idleTimeline.to(b.leftElbow.rotation, { y: "+=0.014", duration: 2.35, ease: "power1.inOut" }, "<");

        gsap.to(b.hips.rotation, { z: 0.022, duration: 3.8, repeat: -1, yoyo: true, ease: "sine.inOut" });
        gsap.to(b.spine.rotation, { z: -0.016, duration: 3.8, repeat: -1, yoyo: true, ease: "sine.inOut" });
    }

    // =========================================================================
    // NEW HUMAN CONVERSATIONAL STATES: LISTEN, PRE-SPEECH, BEAT, LAUGH, SURPRISE, EMPATHY
    // =========================================================================

    /**
     * Subtle 1-beat cervical backchannel nod (used while listening to voice OR as user types!)
     */
    triggerBackchannelNod() {
        if (!this.isLoaded || !this.boneMap?.head || this.isSpeakingNow) return;
        const b = this.boneMap;
        this.setMorph('上', 0.25, 0.15);
        this.setMorph('口角上げ', 0.24, 0.15);

        gsap.to(b.head.rotation, {
            x: "+=0.075",
            duration: 0.18,
            yoyo: true,
            repeat: 1,
            ease: "sine.inOut",
            overwrite: "auto"
        });
        if (b.neck) {
            gsap.to(b.neck.rotation, {
                x: "+=0.035",
                duration: 0.18,
                yoyo: true,
                repeat: 1,
                ease: "sine.inOut",
                overwrite: "auto"
            });
        }
    }

    /**
     * Active Human Listening Pose:
     * 4° forward torso lean, 5° empathetic head cant, locked-in eye contact, raised brows,
     * and automatic backchannel micro-nods every 2.6 seconds while user talks!
     */
    listenPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'listen';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'listen';
        this.gazeMode = 'listening';
        const b = this.boneMap;

        this.clearEmotionalMorphs(0.2);
        this.setMorph('上', 0.30, 0.25);
        this.setMorph('なごみ', 0.24, 0.25);
        this.setMorph('口角上げ', 0.24, 0.25);
        this.setMorph('照れ', 0.18, 0.3);

        const tl = gsap.timeline();
        tl.to(b.spine.position, { z: 0.045, duration: 0.45, ease: "power2.out" }, 0);
        tl.to(b.chest.rotation, { x: 0.055, duration: 0.45, ease: "power2.out" }, 0);
        tl.to(b.head.rotation, { z: -0.09, x: 0.03, duration: 0.45, ease: "power2.out" }, 0);

        // Relaxed attentive hands clasped softly in front
        tl.to(b.rightArm.rotation, { x: 0.20, y: -0.15, z: -0.92, duration: 0.45 }, 0);
        tl.to(b.rightElbow.rotation, { x: 0.38, y: 1.05, z: 0.05, duration: 0.45 }, 0);
        tl.to(b.leftArm.rotation, { x: 0.20, y: 0.15, z: 0.92, duration: 0.45 }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.38, y: -1.05, z: -0.05, duration: 0.45 }, 0);

        this.activeTimeline = tl;

        // Periodic human active-listening backchannel micro-nods
        this.backchannelTimer = setInterval(() => {
            if (this.currentAction === 'listen') {
                this.triggerBackchannelNod();
            } else {
                clearInterval(this.backchannelTimer);
                this.backchannelTimer = null;
            }
        }, 2600);
    }

    /**
     * Instant (<40ms) Pre-Verbal Human Reaction upon receiving user input, BEFORE LLM token #1!
     * Simulates real human neuro-cognitive turn-taking: inspiratory breath + eyebrow flash / cognitive gaze shift.
     */
    preSpeechReaction(intent = 'attentive') {
        if (!this.isLoaded || !this.boneMap) return;
        const b = this.boneMap;

        // Pre-phonatory inspiratory breath (humans inhale slightly right before speaking!)
        this.setMorph('あ', 0.10, 0.14);
        if (b.chest) {
            gsap.to(b.chest.rotation, { x: 0.048, duration: 0.22, ease: "power1.out", overwrite: "auto" });
        }

        if (intent === 'greeting') {
            // Classic 140ms human "Eyebrow Flash" greeting + instant warm Duchenne smile
            this.gazeMode = 'mutual';
            this.setMorph('上', 0.60, 0.10);
            this.setMorph('びっくり', 0.22, 0.10);
            this.setMorph('口角上げ', 0.55, 0.16);
            setTimeout(() => {
                this.setMorph('びっくり', 0, 0.18);
                this.setMorph('にっこり', 0.55, 0.22);
            }, 150);
        } else if (intent === 'empathy') {
            this.gazeMode = 'listening';
            this.empathyPose();
        } else if (intent === 'surprise') {
            this.gazeMode = 'mutual';
            this.surprise();
        } else if (intent === 'laugh') {
            this.gazeMode = 'mutual';
            this.setMorph('にやり', 0.45, 0.15);
            this.setMorph('笑い', 0.45, 0.15);
            this.setMorph('口角上げ', 0.60, 0.15);
        } else if (intent === 'shy') {
            this.gazeMode = 'shy';
            this.shyPose();
        } else {
            // Question / cognitive retrieval: upward-lateral eye glance + asymmetrical brow concentration
            this.gazeMode = 'thinking';
            this.cognitiveOffset = { x: (Math.random() > 0.5 ? 0.13 : -0.13), y: -0.09 };
            this.thinkPose();
        }
    }

    /**
     * Natural Face-to-Face Conversational Talking Posture ('explain') with Palm-Up Beat Gestures
     */
    explainPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'explain';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'explain';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.25);
        this.setMorph('上', 0.22, 0.25);
        this.setMorph('口角上げ', 0.36, 0.25);
        this.setMorph('にこり', 0.28, 0.25);
        this.setMorph('照れ', 0.16, 0.25);

        const tl = gsap.timeline();

        // Slight engaged lean forward
        tl.to(b.spine.position, { z: 0.03, duration: 0.4, ease: "power2.out" }, 0);

        // Axial forearm supination ('右腕捩', '左腕捩') opens palms gently upward & inward like a real speaker!
        if (b.rightArmTwist) tl.to(b.rightArmTwist.rotation, { y: 0.35, duration: 0.4 }, 0);
        if (b.leftArmTwist) tl.to(b.leftArmTwist.rotation, { y: -0.25, duration: 0.4 }, 0);

        tl.to(b.rightArm.rotation, { x: 0.26, y: -0.18, z: -0.82, duration: 0.42, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 0.62, y: 0.92, z: 0.10, duration: 0.42, ease: "power2.out" }, 0);
        tl.to(b.rightWrist.rotation, { x: -0.08, y: 0.22, z: 0.18, duration: 0.42 }, 0);

        tl.to(b.leftArm.rotation, { x: 0.20, y: 0.16, z: 0.90, duration: 0.45, ease: "power2.out" }, 0.04);
        tl.to(b.leftElbow.rotation, { x: 0.46, y: -0.88, z: -0.08, duration: 0.45, ease: "power2.out" }, 0.04);
        tl.to(b.leftWrist.rotation, { x: 0.05, y: -0.18, z: -0.20, duration: 0.45 }, 0.04);

        this.relaxFingers(this.fingerBones.right, 0.18, 'right');
        this.relaxFingers(this.fingerBones.left, 0.24, 'left');

        this.activeTimeline = tl;
    }

    /**
     * Kendon Conversational Speech Beat Impulse:
     * Triggered on stressed spoken words so hands, eyebrows, and head move organically WITH her voice!
     */
    triggerSpeechBeat(emphasis = 0.6) {
        if (!this.isLoaded || !this.boneMap) return;
        const now = performance.now();
        if (now - this.lastBeatTime < 340) return; // Natural ~2.5-3 Hz max human gesture beat frequency
        this.lastBeatTime = now;

        const b = this.boneMap;
        const amp = Math.min(1, Math.max(0.25, emphasis));

        // Subtle cervical prosody pitch accent + slight lateral tilt variation
        if (b.head && (this.currentAction === 'explain' || this.currentAction === 'idle')) {
            const tiltDir = (Math.random() - 0.5) * 0.07 * amp;
            gsap.to(b.head.rotation, {
                x: `+=${0.045 * amp}`,
                z: tiltDir,
                duration: 0.14,
                yoyo: true,
                repeat: 1,
                ease: "power1.out",
                overwrite: "auto"
            });
        }

        // Hand/Forearm conversational beat stroke when in 'explain' or 'idle'
        if (this.currentAction === 'explain' || this.currentAction === 'idle') {
            const useBothHands = amp > 0.72 || Math.random() > 0.55;
            if (b.rightElbow && b.rightWrist) {
                gsap.to(b.rightElbow.rotation, {
                    x: `+=${0.14 * amp}`,
                    duration: 0.15,
                    yoyo: true,
                    repeat: 1,
                    ease: "sine.out",
                    overwrite: "auto"
                });
                gsap.to(b.rightWrist.rotation, {
                    x: `-=${0.12 * amp}`,
                    duration: 0.15,
                    yoyo: true,
                    repeat: 1,
                    ease: "sine.out",
                    overwrite: "auto"
                });
            }
            if (useBothHands && b.leftElbow && b.leftWrist) {
                gsap.to(b.leftElbow.rotation, {
                    x: `+=${0.11 * amp}`,
                    duration: 0.16,
                    yoyo: true,
                    repeat: 1,
                    ease: "sine.out",
                    overwrite: "auto"
                });
            }
        }
    }

    /**
     * Genuine Human Laughter ('laugh'):
     * Duchenne closed-eye crinkle, joyful open smile, hand rising lightly near collarbone, 3x thorax/shoulder chuckle!
     */
    laugh() {
        if (!this.isLoaded) {
            this.pendingAction = 'laugh';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'laugh';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.chest) return;

        this.clearEmotionalMorphs(0.15);
        this.setMorph('笑い', 0.92, 0.18);
        this.setMorph('口角上げ', 0.88, 0.18);
        this.setMorph('ワ', 0.42, 0.18);
        this.setMorph('にこり', 0.75, 0.18);
        this.setMorph('照れ', 0.55, 0.25);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); }
        });

        // Right hand comes up gracefully near upper chest/mouth in genuine amusement
        tl.to(b.rightArm.rotation, { x: 0.32, y: -0.22, z: -0.68, duration: 0.32, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 1.15, y: 1.70, z: -0.12, duration: 0.32, ease: "power2.out" }, 0);
        tl.to(b.rightWrist.rotation, { x: 0.12, y: 0.25, z: 0.30, duration: 0.32 }, 0);
        this.relaxFingers(this.fingerBones.right, 0.28, 'right');

        // Rhythmic 4-beat human diaphragm & shoulder chuckle!
        tl.to([b.rightShoulder.rotation, b.leftShoulder.rotation], {
            z: (i) => (i === 0 ? 0.14 : -0.14),
            duration: 0.13,
            repeat: 5,
            yoyo: true,
            ease: "sine.inOut"
        }, 0.08);
        tl.to(b.spine.position, {
            y: 0.024,
            duration: 0.13,
            repeat: 5,
            yoyo: true,
            ease: "sine.inOut"
        }, 0.08);
        tl.to(b.head.rotation, { x: -0.09, z: 0.07, duration: 0.28, ease: "power2.out" }, 0);
        tl.to({}, { duration: 0.9 });

        this.activeTimeline = tl;
    }

    /**
     * Authentic Human Surprise / Startle ('surprise'):
     * 140ms wide eyes + pupil contraction + raised brows + micro neck/chest pullback + raised open palms!
     */
    surprise() {
        if (!this.isLoaded) {
            this.pendingAction = 'surprise';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'surprise';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.1);
        this.setMorph('びっくり', 0.88, 0.10);
        this.setMorph('瞳小', 0.35, 0.10);
        this.setMorph('上', 0.80, 0.10);
        this.setMorph('お', 0.38, 0.12);
        this.setMorph('照れ', 0.32, 0.2);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); }
        });

        // Startle pullback of torso & neck
        tl.to(b.spine.position, { z: -0.04, y: 0.015, duration: 0.16, ease: "back.out(2)" }, 0);
        tl.to(b.head.rotation, { x: -0.08, duration: 0.16, ease: "back.out(2)" }, 0);

        // Both hands lift slightly with open spread fingers
        tl.to(b.rightArm.rotation, { x: 0.28, y: -0.20, z: -0.72, duration: 0.22, ease: "back.out(1.8)" }, 0);
        tl.to(b.rightElbow.rotation, { x: 1.05, y: 1.20, z: 0.10, duration: 0.22 }, 0);
        tl.to(b.leftArm.rotation, { x: 0.28, y: 0.20, z: 0.72, duration: 0.22, ease: "back.out(1.8)" }, 0);
        tl.to(b.leftElbow.rotation, { x: 1.05, y: -1.20, z: -0.10, duration: 0.22 }, 0);

        this.relaxFingers(this.fingerBones.right, 0.08, 'right');
        this.relaxFingers(this.fingerBones.left, 0.08, 'left');

        // Soften from startle into engaged curiosity after 650ms
        tl.add(() => {
            this.setMorph('びっくり', 0.25, 0.35);
            this.setMorph('瞳小', 0, 0.35);
            this.setMorph('お', 0, 0.25);
            this.setMorph('口角上げ', 0.35, 0.35);
        }, 0.65);
        tl.to({}, { duration: 1.1 });

        this.activeTimeline = tl;
    }

    /**
     * Heartfelt Human Empathy / Compassion ('empathy'):
     * Concerned inner brows ('困る'), tender eyes ('なごみ', 'はぅ'), right hand gently over heart, warm lean-in!
     */
    empathyPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'empathy';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'empathy';
        this.gazeMode = 'listening';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.25);
        this.setMorph('困る', 0.68, 0.3);
        this.setMorph('なごみ', 0.45, 0.3);
        this.setMorph('はぅ', 0.26, 0.3);
        this.setMorph('口角上げ', 0.22, 0.3);
        this.setMorph('照れ', 0.28, 0.35);

        const tl = gsap.timeline();

        // Warm empathetic forward lean + caring head cant
        tl.to(b.spine.position, { z: 0.06, duration: 0.55, ease: "power2.out" }, 0);
        tl.to(b.chest.rotation, { x: 0.07, duration: 0.55, ease: "power2.out" }, 0);
        tl.to(b.head.rotation, { z: -0.11, x: 0.05, duration: 0.55, ease: "power2.out" }, 0);

        // Right hand gently rests over heart/chest
        tl.to(b.rightArm.rotation, { x: 0.36, y: -0.12, z: -0.78, duration: 0.55, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 0.32, y: 1.92, z: -0.18, duration: 0.55, ease: "power2.out" }, 0);
        tl.to(b.rightWrist.rotation, { x: 0.08, y: 0.28, z: 0.20, duration: 0.55 }, 0);

        // Left arm softly open/receptive
        tl.to(b.leftArm.rotation, { x: 0.22, y: 0.16, z: 0.90, duration: 0.55 }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.42, y: -0.85, z: -0.08, duration: 0.55 }, 0);

        this.relaxFingers(this.fingerBones.right, 0.28, 'right');
        this.relaxFingers(this.fingerBones.left, 0.24, 'left');

        this.activeTimeline = tl;
    }

    // =========================================================================
    // CLASSIC 11 POSES (REFINED WITH KENDON ANTICIPATION & SETTLE)
    // =========================================================================

    wave() {
        if (!this.isLoaded) {
            this.pendingAction = 'wave';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'wave';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.rightShoulder) return;

        this.clearEmotionalMorphs(0.2);
        this.setMorph('笑い', 0.85, 0.25);
        this.setMorph('にっこり', 0.80, 0.25);
        this.setMorph('上', 0.45, 0.2); // Human greeting eyebrow lift!
        this.setMorph('照れ', 0.45, 0.3);
        this.setMorph('口角上げ', 0.65, 0.25);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); else this.explainPose(); }
        });

        tl.to(b.rightShoulder.rotation, { z: 0.18, y: 0.10, duration: 0.28, ease: "power2.out" }, 0);
        tl.to(b.spine.rotation, { z: -0.04, duration: 0.38, ease: "power2.out" }, 0);
        tl.to(b.rightArm.rotation, { z: 0.55, x: -0.28, y: -0.22, duration: 0.45, ease: "back.out(1.5)" }, 0.06);
        tl.to(b.rightElbow.rotation, { x: 1.48, y: 0.35, z: 0.15, duration: 0.45, ease: "power2.out" }, 0.08);

        tl.to(b.leftArm.rotation, { x: 0.14, y: 0.14, z: 0.98, duration: 0.4 }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.35, y: -0.82, z: -0.08, duration: 0.4 }, 0);
        tl.to(b.leftWrist.rotation, { x: 0.20, y: -0.16, z: -0.24, duration: 0.4 }, 0);

        this.relaxFingers(this.fingerBones.right, 0.12, 'right');

        tl.to(b.rightWrist.rotation, { z: 0.42, x: 0.12, duration: 0.21, repeat: 5, yoyo: true, ease: "sine.inOut" }, 0.22);
        tl.to(b.head.rotation, { z: -0.10, x: -0.04, duration: 0.38, ease: "power1.out" }, 0.12);

        tl.to(b.rightShoulder.rotation, { z: -0.05, y: 0.04, duration: 0.65, ease: "power2.inOut" }, "+=0.15");
        tl.to(b.spine.rotation, { z: 0, duration: 0.65, ease: "power2.inOut" }, "<");
        tl.to(b.rightArm.rotation, { x: 0.14, y: -0.14, z: -0.98, duration: 0.65, ease: "power2.inOut" }, "<");
        tl.to(b.rightElbow.rotation, { x: 0.35, y: 0.82, z: 0.08, duration: 0.65, ease: "power2.out" }, "<");
        tl.to(b.rightWrist.rotation, { x: 0.20, y: 0.16, z: 0.24, duration: 0.65, ease: "power2.out" }, "<");
        tl.to(b.head.rotation, { z: 0, x: 0, duration: 0.5, ease: "power2.out" }, "<");

        this.activeTimeline = tl;
    }

    crossArms() {
        if (!this.isLoaded) {
            this.pendingAction = 'crossArms';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'crossArms';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.25);
        this.setMorph('じと目', 0.62, 0.32);
        this.setMorph('怒り', 0.38, 0.32);
        this.setMorph('にやり', 0.35, 0.32);
        this.setMorph('照れ', 0.32, 0.35);

        const tl = gsap.timeline();
        tl.to(b.rightShoulder.rotation, { z: 0.08, y: 0.12, duration: 0.5 }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.08, y: -0.12, duration: 0.5 }, 0);
        tl.to(b.rightArm.rotation, { x: 0.35, y: -0.25, z: -0.70, duration: 0.52, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 0.25, y: 1.85, z: -0.20, duration: 0.52, ease: "power2.out" }, 0);
        tl.to(b.rightWrist.rotation, { x: 0.15, y: 0.25, z: 0.35, duration: 0.52 }, 0);
        tl.to(b.leftArm.rotation, { x: 0.35, y: 0.25, z: 0.70, duration: 0.52, ease: "power2.out" }, 0.05);
        tl.to(b.leftElbow.rotation, { x: 0.25, y: -1.85, z: 0.20, duration: 0.52, ease: "power2.out" }, 0.05);
        tl.to(b.leftWrist.rotation, { x: 0.15, y: -0.25, z: -0.35, duration: 0.52 }, 0.05);

        this.relaxFingers(this.fingerBones.right, 0.42, 'right');
        this.relaxFingers(this.fingerBones.left, 0.42, 'left');

        tl.to(b.head.rotation, { x: -0.06, y: 0.15, z: 0.06, duration: 0.48, ease: "power1.out" }, 0.08);
        this.activeTimeline = tl;
    }

    reachHand() {
        if (!this.isLoaded) {
            this.pendingAction = 'reachHand';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'reachHand';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm) return;

        this.clearEmotionalMorphs(0.2);
        this.setMorph('星目', 0.55, 0.25);
        this.setMorph('にっこり', 0.85, 0.25);
        this.setMorph('上', 0.35, 0.25);
        this.setMorph('口角上げ', 0.60, 0.25);
        this.setMorph('照れ', 0.45, 0.3);

        const tl = gsap.timeline();
        tl.to(b.spine.position, { z: 0.08, duration: 0.52, ease: "power2.out" }, 0);
        tl.to(b.chest.rotation, { x: 0.09, duration: 0.52, ease: "power2.out" }, 0);
        if (b.rightArmTwist) tl.to(b.rightArmTwist.rotation, { y: 0.42, duration: 0.5 }, 0);
        tl.to(b.rightArm.rotation, { x: 0.55, y: -0.15, z: -0.38, duration: 0.52, ease: "back.out(1.3)" }, 0.05);
        tl.to(b.rightElbow.rotation, { x: 0.35, y: 0.62, z: 0.05, duration: 0.52, ease: "power2.out" }, 0.08);
        tl.to(b.rightWrist.rotation, { x: -0.20, y: 0.18, z: 0.22, duration: 0.52 }, 0.08);

        this.relaxFingers(this.fingerBones.right, 0.12, 'right');

        tl.to(b.leftArm.rotation, { x: 0.14, y: 0.14, z: 0.98, duration: 0.5 }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.35, y: -0.82, z: -0.08, duration: 0.5 }, 0);
        tl.to(b.leftWrist.rotation, { x: 0.20, y: -0.16, z: -0.24, duration: 0.5 }, 0);
        tl.to(b.head.rotation, { z: -0.10, x: -0.04, duration: 0.48, ease: "power1.out" }, 0.08);

        this.activeTimeline = tl;
    }

    shyPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'shy';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'shy';
        this.gazeMode = 'shy';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.25);
        this.setMorph('照れ', 0.95, 0.35);
        this.setMorph('にっこり', 0.58, 0.35);
        this.setMorph('なごみ', 0.42, 0.3);
        this.setMorph('困る', 0.52, 0.35);
        this.setMorph('口角上げ', 0.38, 0.3);

        const tl = gsap.timeline();
        tl.to(b.rightShoulder.rotation, { z: 0.15, y: 0.08, duration: 0.45 }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.15, y: -0.08, duration: 0.45 }, 0);
        tl.to(b.rightArm.rotation, { x: 0.35, y: -0.15, z: -0.80, duration: 0.48, ease: "back.out(1.4)" }, 0);
        tl.to(b.rightElbow.rotation, { x: 0.30, y: 1.95, z: -0.20, duration: 0.48, ease: "back.out(1.4)" }, 0);
        tl.to(b.rightWrist.rotation, { x: 0.10, y: 0.30, z: 0.25, duration: 0.48 }, 0);
        tl.to(b.leftArm.rotation, { x: 0.35, y: 0.15, z: 0.80, duration: 0.48, ease: "back.out(1.4)" }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.30, y: -1.95, z: 0.20, duration: 0.48, ease: "back.out(1.4)" }, 0);
        tl.to(b.leftWrist.rotation, { x: 0.10, y: -0.30, z: -0.25, duration: 0.48 }, 0);

        this.relaxFingers(this.fingerBones.right, 0.35, 'right');
        this.relaxFingers(this.fingerBones.left, 0.35, 'left');
        tl.to(b.head.rotation, { x: 0.13, z: 0.06, duration: 0.48, ease: "power2.out" }, 0.08);

        this.activeTimeline = tl;
    }

    nod() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        this.currentAction = 'nod';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.head || !b.neck) return;

        this.clearEmotionalMorphs(0.18);
        this.setMorph('にっこり', 0.72, 0.2);
        this.setMorph('上', 0.35, 0.2);
        this.setMorph('口角上げ', 0.50, 0.2);
        this.setMorph('照れ', 0.32, 0.2);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); else this.explainPose(); }
        });

        tl.to(b.neck.rotation, { x: 0.08, duration: 0.20, repeat: 3, yoyo: true, ease: "sine.inOut" }, 0);
        tl.to(b.head.rotation, { x: 0.17, duration: 0.20, repeat: 3, yoyo: true, ease: "sine.inOut" }, 0);

        this.activeTimeline = tl;
    }

    shakeHead() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        this.currentAction = 'shake_head';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.head || !b.neck) return;

        this.clearEmotionalMorphs(0.18);
        this.setMorph('困る', 0.62, 0.2);
        this.setMorph('じと目', 0.28, 0.2);
        this.setMorph('口角下げ', 0.28, 0.2);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); else this.explainPose(); }
        });

        tl.to(b.neck.rotation, { y: 0.10, duration: 0.17, repeat: 4, yoyo: true, ease: "sine.inOut" }, 0);
        tl.to(b.head.rotation, { y: 0.21, duration: 0.17, repeat: 4, yoyo: true, ease: "sine.inOut" }, 0);

        this.activeTimeline = tl;
    }

    thinkPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'think';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'think';
        this.gazeMode = 'thinking';
        this.cognitiveOffset = { x: 0.12, y: -0.09 };
        const b = this.boneMap;
        if (!b.rightArm || !b.head) return;

        this.clearEmotionalMorphs(0.22);
        this.setMorph('眉頭左', 0.42, 0.28);
        this.setMorph('真面目', 0.28, 0.28);
        this.setMorph('う', 0.18, 0.28);
        this.setMorph('口角上げ', 0.14, 0.28);

        const tl = gsap.timeline();
        tl.to(b.rightArm.rotation, { x: 0.25, y: -0.15, z: -0.65, duration: 0.45, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 1.25, y: 1.85, z: -0.10, duration: 0.45, ease: "power2.out" }, 0);
        tl.to(b.rightWrist.rotation, { x: 0.15, y: 0.35, z: 0.45, duration: 0.45 }, 0);

        tl.to(b.leftArm.rotation, { x: 0.14, y: 0.14, z: 0.98, duration: 0.45 }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.35, y: -0.82, z: -0.08, duration: 0.45 }, 0);
        tl.to(b.leftWrist.rotation, { x: 0.20, y: -0.16, z: -0.24, duration: 0.45 }, 0);

        this.relaxFingers(this.fingerBones.right, 0.38, 'right');
        this.relaxFingers(this.fingerBones.left, 0.32, 'left');

        tl.to(b.head.rotation, { x: -0.06, y: 0.13, z: 0.05, duration: 0.45, ease: "power2.out" }, 0.04);
        this.activeTimeline = tl;
    }

    poutPose() {
        if (!this.isLoaded) {
            this.pendingAction = 'pout';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'pout';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.head || !b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.22);
        this.setMorph('怒り', 0.72, 0.28);
        this.setMorph('じと目', 0.52, 0.28);
        this.setMorph('口角下げ', 0.35, 0.28);
        this.setMorph('照れ', 0.48, 0.28);
        this.setMorph('う', 0.24, 0.28);

        const tl = gsap.timeline();
        tl.to(b.rightArm.rotation, { x: 0.15, y: -0.20, z: -0.95, duration: 0.42, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 0.45, y: 1.15, z: 0.15, duration: 0.42 }, 0);
        tl.to(b.rightWrist.rotation, { x: 0.25, y: 0.20, z: 0.30, duration: 0.42 }, 0);

        tl.to(b.leftArm.rotation, { x: 0.15, y: 0.20, z: 0.95, duration: 0.42, ease: "power2.out" }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.45, y: -1.15, z: -0.15, duration: 0.42 }, 0);
        tl.to(b.leftWrist.rotation, { x: 0.25, y: -0.20, z: -0.30, duration: 0.42 }, 0);

        this.relaxFingers(this.fingerBones.right, 0.42, 'right');
        this.relaxFingers(this.fingerBones.left, 0.42, 'left');

        tl.to(b.head.rotation, { y: -0.26, z: -0.08, x: 0.04, duration: 0.42, ease: "back.out(1.2)" }, 0);
        this.activeTimeline = tl;
    }

    wink() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        this.currentAction = 'wink';
        this.gazeMode = 'mutual';
        const b = this.boneMap;

        this.clearEmotionalMorphs(0.12);
        this.setMorph('ウィンク', 1.0, 0.11);
        this.setMorph('にやり', 0.55, 0.14);
        this.setMorph('照れ', 0.55, 0.15);
        this.setMorph('口角上げ', 0.72, 0.15);
        this.setMorph('星目', 0.35, 0.15);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); else this.explainPose(); }
        });

        if (b.rightArm && b.rightElbow) {
            tl.to(b.rightArm.rotation, { x: 0.05, y: -0.35, z: -0.10, duration: 0.34, ease: "back.out(1.4)" }, 0);
            tl.to(b.rightElbow.rotation, { x: 1.75, y: 1.15, z: -0.15, duration: 0.34 }, 0);
            tl.to(b.rightWrist.rotation, { x: 0.15, y: 0.20, z: 0.25, duration: 0.34 }, 0);
            this.relaxFingers(this.fingerBones.right, 0.22, 'right');
        }
        if (b.head) {
            tl.to(b.head.rotation, { z: 0.12, x: -0.05, duration: 0.34, ease: "power2.out" }, 0);
        }
        tl.to({}, { duration: 1.1 });
        this.activeTimeline = tl;
    }

    cheer() {
        if (!this.isLoaded) {
            this.pendingAction = 'cheer';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'cheer';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.2);
        this.setMorph('星目', 0.82, 0.22);
        this.setMorph('笑い', 0.82, 0.22);
        this.setMorph('にっこり', 0.92, 0.22);
        this.setMorph('口角上げ', 0.82, 0.22);
        this.setMorph('上', 0.55, 0.22);
        this.setMorph('照れ', 0.60, 0.28);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); else this.explainPose(); }
        });

        tl.to(b.rightShoulder.rotation, { z: 0.20, duration: 0.32 }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.20, duration: 0.32 }, 0);
        tl.to(b.rightArm.rotation, { z: 0.65, x: -0.15, y: -0.25, duration: 0.42, ease: "back.out(1.8)" }, 0.04);
        tl.to(b.rightElbow.rotation, { x: 1.65, y: 0.35, duration: 0.42 }, 0.04);
        tl.to(b.leftArm.rotation, { z: -0.65, x: -0.15, y: 0.25, duration: 0.42, ease: "back.out(1.8)" }, 0.04);
        tl.to(b.leftElbow.rotation, { x: 1.65, y: -0.35, duration: 0.42 }, 0.04);

        this.relaxFingers(this.fingerBones.right, 0.15, 'right');
        this.relaxFingers(this.fingerBones.left, 0.15, 'left');

        tl.to(b.spine.position, { y: 0.032, duration: 0.17, repeat: 5, yoyo: true, ease: "sine.inOut" }, 0.08);
        tl.to(b.head.rotation, { x: -0.10, duration: 0.32, ease: "power2.out" }, 0.04);
        tl.to({}, { duration: 1.3 });

        this.activeTimeline = tl;
    }

    /**
     * Natural Human Two-Hand Palm-Up Shrug ('shrug'):
     * Clavicle lift + axial forearm supination + playful head cant + asymmetrical inner brow + wry smirk!
     */
    shrug() {
        if (!this.isLoaded) {
            this.pendingAction = 'shrug';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'shrug';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.16);
        this.setMorph('眉頭左', 0.52, 0.20);
        this.setMorph('上', 0.38, 0.20);
        this.setMorph('にやり', 0.48, 0.22);
        this.setMorph('口角上げ', 0.42, 0.22);
        this.setMorph('照れ', 0.26, 0.25);

        const tl = gsap.timeline({
            onComplete: () => { if (!this.isSpeakingNow) this.resetToIdle(); else this.explainPose(); }
        });

        // Clavicles shrug upward + palms rotate open
        tl.to(b.rightShoulder.rotation, { z: 0.22, y: 0.06, duration: 0.30, ease: "back.out(1.6)" }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.22, y: -0.06, duration: 0.30, ease: "back.out(1.6)" }, 0);
        if (b.rightArmTwist) tl.to(b.rightArmTwist.rotation, { y: 0.50, duration: 0.30 }, 0);
        if (b.leftArmTwist) tl.to(b.leftArmTwist.rotation, { y: -0.50, duration: 0.30 }, 0);

        tl.to(b.rightArm.rotation, { x: 0.24, y: -0.26, z: -0.74, duration: 0.32, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 0.92, y: 0.68, z: 0.14, duration: 0.32, ease: "power2.out" }, 0);
        tl.to(b.rightWrist.rotation, { x: -0.18, y: 0.20, z: 0.20, duration: 0.32 }, 0);

        tl.to(b.leftArm.rotation, { x: 0.24, y: 0.26, z: 0.74, duration: 0.32, ease: "power2.out" }, 0);
        tl.to(b.leftElbow.rotation, { x: 0.92, y: -0.68, z: -0.14, duration: 0.32, ease: "power2.out" }, 0);
        tl.to(b.leftWrist.rotation, { x: -0.18, y: -0.20, z: -0.20, duration: 0.32 }, 0);

        this.relaxFingers(this.fingerBones.right, 0.12, 'right');
        this.relaxFingers(this.fingerBones.left, 0.12, 'left');

        tl.to(b.head.rotation, { z: 0.12, x: -0.04, duration: 0.30, ease: "power2.out" }, 0.04);
        tl.to({}, { duration: 0.75 });

        // Relaxed human exhale drop of shoulders
        tl.to([b.rightShoulder.rotation, b.leftShoulder.rotation], { z: 0, duration: 0.45, ease: "power2.inOut" });
        this.activeTimeline = tl;
    }

    /**
     * Authentic Human Desk-Companion Overhead Stretch & Relaxed Sigh ('stretch'):
     * Raised arms + arched upper thoracic spine + contented closed eyes ('なごみ') + refreshed blink!
     */
    stretch() {
        if (!this.isLoaded) {
            this.pendingAction = 'stretch';
            return;
        }
        this.killActiveTimeline();
        this.currentAction = 'stretch';
        this.gazeMode = 'mutual';
        const b = this.boneMap;
        if (!b.rightArm || !b.leftArm) return;

        this.clearEmotionalMorphs(0.25);
        this.setMorph('なごみ', 0.82, 0.35);
        this.setMorph('にっこり', 0.65, 0.35);
        this.setMorph('あ', 0.16, 0.35);
        this.setMorph('照れ', 0.35, 0.35);

        const tl = gsap.timeline({
            onComplete: () => {
                this.triggerNaturalBlink(0);
                if (!this.isSpeakingNow) this.resetToIdle();
            }
        });

        tl.to(b.rightShoulder.rotation, { z: 0.24, duration: 0.55, ease: "sine.inOut" }, 0);
        tl.to(b.leftShoulder.rotation, { z: -0.24, duration: 0.55, ease: "sine.inOut" }, 0);
        tl.to(b.chest.rotation, { x: -0.09, duration: 0.60, ease: "sine.inOut" }, 0);
        tl.to(b.head.rotation, { x: -0.11, z: 0.06, duration: 0.60, ease: "sine.inOut" }, 0);

        tl.to(b.rightArm.rotation, { z: 0.78, x: -0.22, y: -0.20, duration: 0.62, ease: "power2.out" }, 0);
        tl.to(b.rightElbow.rotation, { x: 1.35, y: 0.50, duration: 0.62, ease: "power2.out" }, 0);
        tl.to(b.leftArm.rotation, { z: -0.78, x: -0.22, y: 0.20, duration: 0.62, ease: "power2.out" }, 0);
        tl.to(b.leftElbow.rotation, { x: 1.35, y: -0.50, duration: 0.62, ease: "power2.out" }, 0);

        this.relaxFingers(this.fingerBones.right, 0.14, 'right');
        this.relaxFingers(this.fingerBones.left, 0.14, 'left');

        tl.to({}, { duration: 0.95 });
        tl.add(() => {
            this.setMorph('なごみ', 0, 0.30);
            this.setMorph('あ', 0, 0.25);
            this.setMorph('口角上げ', 0.45, 0.30);
        });
        tl.to({}, { duration: 0.35 });

        this.activeTimeline = tl;
    }

    /**
     * Feed real-time webcam viewer face coordinates into Miku's mutual eye-contact tracker
     */
    setViewerGaze(x, y, active = true) {
        this.webcamGaze.active = !!active;
        if (active) {
            this.webcamGaze.x = Math.max(-1, Math.min(1, x || 0));
            this.webcamGaze.y = Math.max(-1, Math.min(1, y || 0));
        }
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
            case 'laugh':       this.laugh(); break;
            case 'surprise':    this.surprise(); break;
            case 'empathy':     this.empathyPose(); break;
            case 'listen':      this.listenPose(); break;
            case 'explain':     this.explainPose(); break;
            case 'shrug':       this.shrug(); break;
            case 'stretch':     this.stretch(); break;
            case 'idle':
            default:            this.resetToIdle(); break;
        }
    }

    resetToIdle() {
        if (!this.isLoaded) return;
        this.killActiveTimeline();
        this.currentAction = 'idle';
        this.gazeMode = 'mutual';
        this.cognitiveOffset = { x: 0, y: 0 };

        this.clearEmotionalMorphs(0.38);
        this.setMorph('あ', 0, 0.2);
        this.setMorph('い', 0, 0.2);
        this.setMorph('う', 0, 0.2);
        this.setMorph('え', 0, 0.2);
        this.setMorph('お', 0, 0.2);
        this.setMorph('ん', 0, 0.2);
        this.setMorph('口横広げ', 0, 0.2);

        this.setRestPose();
    }

    // =========================================================================
    // 6-VISEME + BILABIAL ('ん') HUMAN SPEECH CO-ARTICULATION
    // =========================================================================

    /**
     * Drives real-time human vowel visemes ('あ','い','う','え','お'), bilabial closure ('ん' for m/b/p),
     * lateral mouth stretch ('口横広げ'), eyebrow prosody, and Kendon hand beat gestures!
     */
    setMouthOpenness(val, viseme = null) {
        if (!this.isLoaded) return;
        const openness = Math.max(0, Math.min(1, val));

        // Transition gaze back from cognitive thinking to warm mutual eye contact as soon as speech starts!
        if ((openness > 0.04 || (viseme && viseme.vowel === 'm')) && !this.isSpeakingNow) {
            this.isSpeakingNow = true;
            if (this.gazeMode === 'thinking') {
                this.gazeMode = 'mutual';
                this.cognitiveOffset = { x: 0, y: 0 };
                this.triggerNaturalBlink(0);
            }
        } else if (openness <= 0.01 && (!viseme || viseme.vowel === 'sil')) {
            this.isSpeakingNow = false;
        }

        // Structured Phoneme-to-Viseme Path
        if (viseme && viseme.vowel) {
            const v = viseme.vowel;
            let a = 0, i = 0, u = 0, e = 0, o = 0, m = 0, wide = 0;

            if (v === 'm') {
                // True bilabial lip closure (/m/, /b/, /p/)!
                m = 0.78;
                wide = 0.08;
            } else if (v === 'a') {
                a = openness * 0.88;
                e = openness * 0.14;
                wide = openness * 0.20;
            } else if (v === 'i') {
                i = openness * 0.80;
                e = openness * 0.15;
                wide = openness * 0.38;
            } else if (v === 'u') {
                u = openness * 0.84;
                o = openness * 0.16;
            } else if (v === 'e') {
                e = openness * 0.78;
                a = openness * 0.16;
                i = openness * 0.18;
                wide = openness * 0.26;
            } else if (v === 'o') {
                o = openness * 0.86;
                u = openness * 0.18;
            } else if (v === 'sil' && viseme.breath) {
                a = 0.08; // Subtle inter-clause breath intake
            }

            this.setMorph('あ', a, 0.038);
            this.setMorph('い', i, 0.038);
            this.setMorph('う', u, 0.038);
            this.setMorph('え', e, 0.038);
            this.setMorph('お', o, 0.038);
            this.setMorph('ん', m, 0.032);
            this.setMorph('口横広げ', wide, 0.045);

            if (v !== 'sil') {
                const smile = 0.18 + openness * 0.28;
                const browAccent = (viseme.emphasis || openness) > 0.55 ? 0.28 : 0.10;
                this.setMorph('口角上げ', smile, 0.06);
                this.setMorph('上', browAccent, 0.07);
                if (viseme.beat) {
                    this.triggerSpeechBeat(viseme.emphasis || openness);
                }
            } else if (!viseme.breath) {
                this.setMorph('口角上げ', 0.16, 0.10);
                this.setMorph('上', 0.05, 0.12);
            }
            return;
        }

        // Fallback scalar openness path
        if (openness > 0.04) {
            const time = performance.now() * 0.013;
            const cycle = Math.sin(time);
            const cycleCos = Math.cos(time * 0.84);

            this.setMorph('あ', openness * (0.50 + 0.35 * Math.max(0, cycle)), 0.04);
            this.setMorph('い', openness * (0.25 + 0.30 * Math.max(0, cycleCos)), 0.04);
            this.setMorph('え', openness * 0.22, 0.04);
            this.setMorph('お', openness * (0.20 + 0.32 * Math.max(0, -cycle)), 0.04);
            this.setMorph('う', openness * (0.14 + 0.22 * Math.max(0, -cycleCos)), 0.04);
            this.setMorph('ん', 0, 0.04);
            this.setMorph('口角上げ', 0.18 + openness * 0.30, 0.05);
            this.setMorph('上', openness > 0.48 ? 0.24 : 0.08, 0.06);
        } else {
            this.setMorph('あ', 0, 0.08);
            this.setMorph('い', 0, 0.08);
            this.setMorph('う', 0, 0.08);
            this.setMorph('え', 0, 0.08);
            this.setMorph('お', 0, 0.08);
            this.setMorph('ん', 0, 0.08);
            this.setMorph('口横広げ', 0, 0.08);
            this.setMorph('口角上げ', 0.12, 0.12);
            this.setMorph('上', 0, 0.12);
        }
    }

    // =========================================================================
    // OCULAR NEUROSCIENCE, SECONDARY SPRING PHYSICS & 60 FPS RENDER LOOP
    // =========================================================================

    /**
     * Adaptive CPU/Memory-Bandwidth Saver:
     * Paces WebGL rendering to 30 FPS while local CPU LLM computes tokens, freeing RAM bandwidth for ~2x faster token/s!
     */
    setInferenceThrottle(active) {
        this.inferenceThrottle = !!active;
        if (this.renderer) {
            this.renderer.setPixelRatio(active ? 1 : Math.min(window.devicePixelRatio || 1, 2));
        }
    }

    startRenderLoop() {
        const render = () => {
            this.frameTick++;
            if (this.inferenceThrottle && (this.frameTick % 2 === 1)) {
                requestAnimationFrame(render);
                return;
            }

            const dt = Math.min(0.05, this.clock.getDelta());
            const elapsed = this.clock.getElapsedTime();

            if (this.controls) {
                this.controls.update();
            }

            this.updateAdditiveBreathingAndEyeShimmer(elapsed);
            this.updateLivingGazeAndSaccades(elapsed);
            this.updateSecondaryPhysics(dt, elapsed);
            this.updateParticles(elapsed);

            this.renderer.render(this.scene, this.camera);
            requestAnimationFrame(render);
        };
        render();
    }

    /**
     * Additive 60 FPS Human Respiratory Layer & Eye Catchlight Shimmer ('光下'):
     * Ensures Miku NEVER freezes her breathing during held poses ('think', 'empathy', 'crossArms', 'listen', 'explain')
     * and keeps subtle wet tear-film sparkle in her eyes!
     */
    updateAdditiveBreathingAndEyeShimmer(t) {
        if (!this.isLoaded || !this.boneMap) return;
        const b = this.boneMap;

        // 1. Living tear-film eye catchlight shimmer ('光下') clamped strictly >= 0.02
        const shimmerVal = Math.max(0.02, 0.18 + 0.14 * Math.sin(t * 2.4) + 0.05 * Math.cos(t * 4.1));
        for (let i = 0; i < this.skinnedMeshes.length; i++) {
            const mesh = this.skinnedMeshes[i];
            const idx = mesh.morphTargetDictionary?.['光下'];
            if (idx !== undefined) {
                mesh.morphTargetInfluences[idx] = shimmerVal;
            }
        }

        // 2. Continuous asymmetrical respiratory wave (~14 breaths/min, 4.25s period) when idleTimeline is paused
        const idlePaused = !this.idleTimeline || this.idleTimeline.paused();
        const rawWave = Math.sin(t * 1.48) + 0.22 * Math.sin(t * 2.96 - 0.8); // Faster inhale, gentler exhale
        const chestBreath = idlePaused ? (rawWave * 0.020) : 0;
        const shoulderBreath = idlePaused ? (rawWave * 0.0028) : 0;

        const dChest = chestBreath - this.additiveBreath.prevChest;
        const dShoulder = shoulderBreath - this.additiveBreath.prevShoulder;
        this.additiveBreath.prevChest = chestBreath;
        this.additiveBreath.prevShoulder = shoulderBreath;

        if (b.groove) {
            b.groove.position.y = idlePaused ? (rawWave * 0.0065) : 0;
        }
        if (idlePaused && b.chest && (!window.gsap || !gsap.isTweening(b.chest.rotation))) {
            b.chest.rotation.x += dChest;
        }
        if (idlePaused && b.rightShoulder && b.leftShoulder) {
            b.rightShoulder.position.y += dShoulder;
            b.leftShoulder.position.y += dShoulder;
        }
    }

    /**
     * Human Gaze Dynamics: Mutual eye contact (webcam face OR cursor), cognitive memory-retrieval glances,
     * saccade-coupled blinks, and distributed cervical-thoracic spine tracking.
     */
    updateLivingGazeAndSaccades(t) {
        if (!this.isLoaded || !this.boneMap || !this.boneMap.head) return;

        // 1. Saccadic micro-darts (quieter when actively listening; natural brief side-glance every ~9s in idle)
        if (t - this.lastSaccadeTime > this.saccadeInterval) {
            this.lastSaccadeTime = t;
            this.saccadeInterval = 1.3 + Math.random() * 2.1;

            const ampScale = this.gazeMode === 'listening' ? 0.45 : 1.0;
            const briefAversion = (this.gazeMode === 'mutual' && !this.isSpeakingNow && Math.random() < 0.14);

            this.saccade.x = briefAversion
                ? (Math.random() > 0.5 ? 0.14 : -0.14)
                : (Math.random() - 0.5) * 0.065 * ampScale;
            this.saccade.y = briefAversion
                ? -0.04
                : (Math.random() - 0.5) * 0.045 * ampScale;
        }

        // 2. Smooth viewer/webcam/cursor tracking + organic biological micro-drift
        const organicDriftX = Math.sin(t * 0.65) * 0.018 + Math.cos(t * 1.15) * 0.008;
        const organicDriftY = Math.cos(t * 0.52) * 0.012;

        const viewerX = this.webcamGaze.active ? this.webcamGaze.x : this.mouse.x;
        const viewerY = this.webcamGaze.active ? this.webcamGaze.y : this.mouse.y;

        const targetX = (viewerX * 0.36) + organicDriftX + (this.gazeMode === 'thinking' ? this.cognitiveOffset.x : 0);
        const targetY = (-viewerY * 0.22) + organicDriftY + (this.gazeMode === 'thinking' ? this.cognitiveOffset.y : 0);

        this.gaze.x += (targetX - this.gaze.x) * 0.085;
        this.gaze.y += (targetY - this.gaze.y) * 0.085;

        const eyeRotY = (this.gaze.x * 0.52) + this.saccade.x;
        const eyeRotX = (this.gaze.y * 0.42) + this.saccade.y + (this.gazeMode === 'shy' ? 0.07 : 0);

        // Saccadic blink coupling: large gaze shifts naturally trigger a crisp human blink
        const jumpDist = Math.hypot(eyeRotY - this.prevEyeTarget.x, eyeRotX - this.prevEyeTarget.y);
        if (jumpDist > 0.115 && this.currentAction !== 'wink') {
            this.triggerNaturalBlink(0);
        }
        this.prevEyeTarget.x = eyeRotY;
        this.prevEyeTarget.y = eyeRotX;

        const eyeBone = this.boneMap.eyes || this.boneMap.rightEye;
        if (eyeBone) {
            eyeBone.rotation.y = eyeRotY;
            eyeBone.rotation.x = eyeRotX;
        }
        if (this.boneMap.leftEye && this.boneMap.rightEye) {
            this.boneMap.leftEye.rotation.y = eyeRotY;
            this.boneMap.leftEye.rotation.x = eyeRotX;
            this.boneMap.rightEye.rotation.y = eyeRotY;
            this.boneMap.rightEye.rotation.x = eyeRotX;
        }

        // 3. Distributed Cervical-Thoracic Spine Tracking when in idle
        if (!this.activeTimeline && this.currentAction === 'idle') {
            const b = this.boneMap;
            if (b.chest) b.chest.rotation.y = this.gaze.x * 0.18;
            if (b.neck) {
                b.neck.rotation.y = this.gaze.x * 0.28;
                b.neck.rotation.x = this.gaze.y * 0.28;
            }
            if (b.head) {
                b.head.rotation.y = this.gaze.x * 0.54;
                b.head.rotation.x = this.gaze.y * 0.54;
            }
        }
    }

    /**
     * Multi-Chain Inertial Spring-Damper Physics:
     * Simulates 9-link twintails, 3-link cyan necktie, front bangs, sideburns, and ahoge!
     */
    updateSecondaryPhysics(dt, elapsed) {
        if (!this.isLoaded || !this.boneMap || !this.boneMap.head) return;

        const hp = this.hairPhysics;
        const b = this.boneMap;
        const headRotY = b.head.rotation.y;
        const headRotX = b.head.rotation.x;
        const headRotZ = b.head.rotation.z;
        const spineY = b.spine ? b.spine.position.y : 0;
        const verticalImpulse = (spineY - hp.prevSpineY) / Math.max(0.008, dt);
        hp.prevSpineY = spineY;

        // 1. 9-Segment Twintails (lateral sway + vertical bounce inertia!)
        const hairCount = Math.min(this.hairLeft.length, 9);
        for (let i = 0; i < hairCount; i++) {
            const stiffness = Math.max(5.5, 21.0 - i * 2.0);
            const damping = 0.86;

            const breeze = Math.sin(elapsed * 1.6 + i * 0.45) * 0.012;
            const targetZ = -headRotY * (0.22 + i * 0.10) - verticalImpulse * (0.04 + i * 0.015) + breeze;
            const targetX = -headRotX * (0.16 + i * 0.07);

            const forceL = (targetZ - hp.leftChain[i]) * stiffness;
            hp.leftVel[i] = (hp.leftVel[i] + forceL * dt) * damping;
            hp.leftChain[i] += hp.leftVel[i] * dt;

            if (this.hairLeft[i]) {
                this.hairLeft[i].rotation.z = hp.leftChain[i];
                this.hairLeft[i].rotation.x = targetX;
            }

            const forceR = (-targetZ - hp.rightChain[i]) * stiffness;
            hp.rightVel[i] = (hp.rightVel[i] + forceR * dt) * damping;
            hp.rightChain[i] += hp.rightVel[i] * dt;

            if (this.hairRight[i]) {
                this.hairRight[i].rotation.z = -hp.rightChain[i];
                this.hairRight[i].rotation.x = targetX;
            }
        }

        // 2. 3-Segment Cyan Necktie Pendulum (reacts to chest lean, breathing & hip/spine sway!)
        const chestPitch = (b.chest ? b.chest.rotation.x : 0) + (b.spine ? b.spine.position.z * 1.4 : 0);
        const torsoRoll = (b.spine ? b.spine.rotation.z : 0) + (b.hips ? b.hips.rotation.z : 0);
        for (let i = 0; i < this.necktieBones.length; i++) {
            const tieBone = this.necktieBones[i];
            const baseRot = this.defaultRotations[tieBone.name];
            const stiff = 18.0 - i * 3.0;
            const targetTieX = (baseRot ? baseRot.x : 0) + chestPitch * (0.35 + i * 0.18);
            const targetTieZ = (baseRot ? baseRot.z : 0) - torsoRoll * (0.65 + i * 0.25) + Math.sin(elapsed * 1.9 + i) * 0.008;

            hp.tieVelX[i] = (hp.tieVelX[i] + (targetTieX - hp.tieChainX[i]) * stiff * dt) * 0.85;
            hp.tieChainX[i] += hp.tieVelX[i] * dt;

            hp.tieVelZ[i] = (hp.tieVelZ[i] + (targetTieZ - hp.tieChainZ[i]) * stiff * dt) * 0.85;
            hp.tieChainZ[i] += hp.tieVelZ[i] * dt;

            tieBone.rotation.x = hp.tieChainX[i];
            tieBone.rotation.z = hp.tieChainZ[i];
        }

        // 3. Front Bangs & Sideburns subtle nod/turn lag
        const targetBangs = -headRotX * 0.22 - verticalImpulse * 0.025;
        hp.bangsVel = (hp.bangsVel + (targetBangs - hp.bangsX) * 24.0 * dt) * 0.82;
        hp.bangsX += hp.bangsVel * dt;
        this.bangsBones.forEach((bb) => {
            const def = this.defaultRotations[bb.name];
            bb.rotation.x = (def ? def.x : 0) + hp.bangsX;
        });
        this.sideburnBones.forEach((sb) => {
            const def = this.defaultRotations[sb.name];
            sb.rotation.z = (def ? def.z : 0) - headRotZ * 0.28;
            sb.rotation.x = (def ? def.x : 0) + hp.bangsX * 0.8;
        });

        // 4. Expressive Ahoge (top hair strand) spring bounce!
        const targetAhoge = -headRotZ * 0.45 - headRotY * 0.25 + Math.sin(elapsed * 2.6) * 0.03;
        hp.ahogeVel = (hp.ahogeVel + (targetAhoge - hp.ahogeZ) * 22.0 * dt) * 0.80;
        hp.ahogeZ += hp.ahogeVel * dt;
        this.ahogeBones.forEach((ab) => {
            const def = this.defaultRotations[ab.name];
            ab.rotation.z = (def ? def.z : 0) + hp.ahogeZ;
        });
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
}
