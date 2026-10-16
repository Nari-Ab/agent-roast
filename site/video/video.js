/**
 * agent-roast — Cinematic Video Reel Engine (v2.0)
 * 60FPS DOM 3D Camera Rig + Canvas Atmospheric Layer + Synced Neural AI Voiceover & Procedural SFX
 **/

(function() {
  'use strict';

  // --- Constants & Timeline Definition ---
  const DURATION = 33.5; // Total duration in seconds
  const FPS = 60;

  const SCENES = [
    { id: 'scene-1', start: 0.0, end: 5.6, audioKey: 'scene1', title: 'The Hook', glow: 'rgba(16, 185, 129, 0.18)' },
    { id: 'scene-2', start: 5.6, end: 13.0, audioKey: 'scene2', title: 'The Crime', glow: 'rgba(244, 63, 94, 0.22)' },
    { id: 'scene-3', start: 13.0, end: 20.8, audioKey: 'scene3', title: 'The Audit', glow: 'rgba(6, 182, 212, 0.20)' },
    { id: 'scene-4', start: 20.8, end: 27.0, audioKey: 'scene4', title: 'The Roast', glow: 'rgba(244, 63, 94, 0.25)' },
    { id: 'scene-5', start: 27.0, end: 33.5, audioKey: 'scene5', title: 'Outro', glow: 'rgba(16, 185, 129, 0.24)' }
  ];

  // --- DOM Elements ---
  const phoneFrame = document.getElementById('phone-frame');
  const phoneScreen = document.getElementById('phone-screen');
  const sceneCamera = document.getElementById('scene-camera');
  const ambientGlow = document.getElementById('ambient-glow');
  const bgCanvas = document.getElementById('bg-canvas');
  const bgCtx = bgCanvas ? bgCanvas.getContext('2d') : null;
  const hudTimecode = document.getElementById('hud-timecode');

  // Scene layers
  const sceneEls = {
    'scene-1': document.getElementById('scene-1'),
    'scene-2': document.getElementById('scene-2'),
    'scene-3': document.getElementById('scene-3'),
    'scene-4': document.getElementById('scene-4'),
    'scene-5': document.getElementById('scene-5')
  };

  // Scene 1 elements
  const kline1 = document.getElementById('kline-1');
  const kline2 = document.getElementById('kline-2');
  const kbox3 = document.getElementById('kbox-3');
  const hookSubline = document.getElementById('hook-subline');

  // Scene 2 elements
  const codeWindow = document.getElementById('code-window');
  const targetReticle = document.getElementById('target-reticle');
  const pill1 = document.getElementById('pill-1');
  const pill2 = document.getElementById('pill-2');
  const pill3 = document.getElementById('pill-3');

  // Scene 3 elements
  const auditCmdText = document.getElementById('audit-cmd-text');
  const termFeed = document.getElementById('term-feed');
  const feedItems = termFeed ? termFeed.querySelectorAll('.feed-item') : [];
  const specsGrid = document.getElementById('specs-grid');
  const specTiles = specsGrid ? specsGrid.querySelectorAll('.spec-tile') : [];

  // Scene 4 elements
  const gaugeArc = document.getElementById('gauge-arc');
  const scoreCounter = document.getElementById('score-counter');
  const verdictStamp = document.getElementById('verdict-stamp');
  const proofCard = document.getElementById('proof-card');
  const ciGateCard = document.getElementById('ci-gate-card');

  // Scene 5 elements
  const outroCmd = document.getElementById('outro-cmd');
  const outroCiBox = document.querySelector('.outro-ci-box');
  const outroMeta = document.querySelector('.outro-meta');

  // Controls
  const btnPlay = document.getElementById('btn-play');
  const btnRestart = document.getElementById('btn-restart');
  const btnAudioToggle = document.getElementById('btn-audio-toggle');
  const audioStatusLabel = document.getElementById('audio-status-label');
  const btnExport = document.getElementById('btn-export');
  const btnSoundTest = document.getElementById('btn-sound-test');
  const btnAspect = document.getElementById('btn-aspect');
  const timeDisplay = document.getElementById('time-display');
  const timelineTrack = document.getElementById('timeline-track');
  const timelineProgress = document.getElementById('timeline-progress');
  const timelinePlayhead = document.getElementById('timeline-playhead');
  const scJumpButtons = document.querySelectorAll('.sc-jump');

  // --- Engine State ---
  let currentTime = 0;
  let isPlaying = false;
  let lastTimestamp = 0;
  let currentVoice = 'en'; // 'en', 'ru', or 'muted'
  let isLandscape = false;
  let cameraTrauma = 0; // Screen shake magnitude (0 to 1)

  // SFX Trigger Tracking (prevents re-firing during normal linear playback)
  const firedSFX = new Set();

  // --- Math & Easing Utilities ---
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function springProgress(t) {
    return easeOutBack(clamp(t, 0, 1));
  }

  // --- Web Audio & Neural Voice System ---
  let audioCtx = null;
  let masterGain = null;
  let streamDest = null;
  const audioTracks = { en: {}, ru: {} };
  let audioTracksInitialized = false;

  function initAudio() {
    if (audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(0.9, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);
      streamDest = audioCtx.createMediaStreamDestination();
      masterGain.connect(streamDest);

      // Preload voiceover audio files
      ['en', 'ru'].forEach(lang => {
        for (let i = 1; i <= 5; i++) {
          const audio = new Audio(`audio/scene${i}_${lang}.m4a`);
          audio.preload = 'auto';
          audioTracks[lang][`scene${i}`] = audio;
        }
      });
      audioTracksInitialized = true;
    } catch (e) {
      console.warn('Web Audio initialization error:', e);
    }
  }

  function ensureAudioContextRunning() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // --- Procedural SFX Generators ---
  function playBassDrop(pitch = 125, duration = 0.5) {
    if (!audioCtx) return;
    ensureAudioContextRunning();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + duration);

    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  function playClick(pitch = 950, duration = 0.04) {
    if (!audioCtx) return;
    ensureAudioContextRunning();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(250, now + duration);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  function playGlitch() {
    if (!audioCtx) return;
    ensureAudioContextRunning();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(750, now + 0.16);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.18);
  }

  function playVerdictStamp() {
    if (!audioCtx) return;
    ensureAudioContextRunning();
    playBassDrop(140, 0.65);

    // Add noise punch
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.15);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  function playWhoosh() {
    if (!audioCtx) return;
    ensureAudioContextRunning();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.exponentialRampToValueAtTime(2200, now + 0.18);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.35);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.35);
  }

  function playAlarm() {
    if (!audioCtx) return;
    ensureAudioContextRunning();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(660, now + 0.1);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.22);
  }

  // --- Voiceover Audio Synchronization ---
  function syncVoiceover(t) {
    if (!audioTracksInitialized || currentVoice === 'muted') {
      pauseAllVoiceovers();
      return;
    }

    const currentScene = SCENES.find(s => t >= s.start && t < s.end);
    const lang = currentVoice; // 'en' or 'ru'

    SCENES.forEach(s => {
      const audio = audioTracks[lang]?.[s.audioKey];
      if (!audio) return;

      if (currentScene && s.id === currentScene.id && isPlaying) {
        const targetAudioTime = clamp(t - s.start, 0, audio.duration || 10);
        // Correct audio drift if larger than 120ms
        if (Math.abs(audio.currentTime - targetAudioTime) > 0.12) {
          audio.currentTime = targetAudioTime;
        }
        if (audio.paused) {
          audio.play().catch(() => {});
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
      }
    });
  }

  function pauseAllVoiceovers() {
    ['en', 'ru'].forEach(lang => {
      Object.values(audioTracks[lang] || {}).forEach(audio => {
        if (!audio.paused) audio.pause();
      });
    });
  }

  // --- SFX Timeline Trigger Check ---
  function triggerSFXAt(t) {
    if (!isPlaying) return;

    function check(key, timeThreshold, action) {
      if (t >= timeThreshold && t < timeThreshold + 0.25 && !firedSFX.has(key)) {
        firedSFX.add(key);
        action();
      }
    }

    // Scene 1
    check('s1-kbox', 2.0, () => {
      playBassDrop(130, 0.45);
      cameraTrauma = 0.4;
    });

    // Scene 2
    check('s2-whoosh', 5.6, playWhoosh);
    check('s2-target', 7.0, () => {
      playGlitch();
      cameraTrauma = 0.35;
    });
    check('s2-pill1', 7.6, () => playClick(900));
    check('s2-pill2', 8.8, () => playClick(820));
    check('s2-pill3', 10.0, () => playClick(740));

    // Scene 3
    check('s3-whoosh', 13.0, playWhoosh);
    check('s3-type1', 13.3, () => playClick(1200));
    check('s3-type2', 13.6, () => playClick(1150));
    check('s3-type3', 13.9, () => playClick(1100));
    check('s3-spec1', 17.5, () => playClick(950));
    check('s3-spec2', 18.4, () => playClick(900));
    check('s3-spec3', 19.3, () => playClick(850));

    // Scene 4
    check('s4-whoosh', 20.8, playWhoosh);
    check('s4-stamp', 22.8, () => {
      playVerdictStamp();
      cameraTrauma = 0.85; // Heavy screen impact!
    });
    check('s4-proof', 23.8, () => playClick(880));
    check('s4-gate', 25.0, () => {
      playAlarm();
      cameraTrauma = 0.4;
    });

    // Scene 5
    check('s5-whoosh', 27.0, () => {
      playWhoosh();
      playBassDrop(110, 0.5);
    });
    check('s5-cmd', 28.3, () => playClick(1050));
  }

  // --- Background Atmospheric Canvas Renderer ---
  const particles = [];
  const NUM_PARTICLES = 45;
  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push({
      x: Math.random() * 1080,
      y: Math.random() * 1920,
      size: Math.random() * 2.2 + 0.8,
      speedY: Math.random() * 1.2 + 0.4,
      alpha: Math.random() * 0.6 + 0.2,
      color: Math.random() > 0.4 ? 'rgba(16, 185, 129,' : 'rgba(6, 182, 212,'
    });
  }

  function renderBackgroundCanvas(t) {
    if (!bgCtx) return;
    const w = bgCanvas.width;
    const h = bgCanvas.height;

    bgCtx.clearRect(0, 0, w, h);

    // Deep space gradient
    const bgGrad = bgCtx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#06080d');
    bgGrad.addColorStop(0.5, '#05070a');
    bgGrad.addColorStop(1, '#020305');
    bgCtx.fillStyle = bgGrad;
    bgCtx.fillRect(0, 0, w, h);

    // Cyber 3D Perspective Grid (Floor)
    const horizon = h * 0.62;
    const gridSpeed = (t * 80) % 60;

    bgCtx.save();
    bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    bgCtx.lineWidth = 1;

    // Horizon glowing line
    bgCtx.beginPath();
    bgCtx.moveTo(0, horizon);
    bgCtx.lineTo(w, horizon);
    bgCtx.stroke();

    // Perspective lines spreading from center horizon
    const centerX = w / 2;
    const numPerspLines = 16;
    for (let i = -numPerspLines; i <= numPerspLines; i++) {
      const spreadX = centerX + i * 95;
      bgCtx.beginPath();
      bgCtx.moveTo(centerX, horizon);
      bgCtx.lineTo(spreadX * 2.5 - centerX * 1.5, h);
      bgCtx.stroke();
    }

    // Moving horizontal grid lines with exponential perspective spacing
    for (let i = 0; i < 18; i++) {
      const p = (i * 35 + gridSpeed) / 600;
      if (p <= 0 || p > 1) continue;
      const py = horizon + Math.pow(p, 2.2) * (h - horizon);
      bgCtx.strokeStyle = `rgba(16, 185, 129, ${0.02 + p * 0.12})`;
      bgCtx.beginPath();
      bgCtx.moveTo(0, py);
      bgCtx.lineTo(w, py);
      bgCtx.stroke();
    }
    bgCtx.restore();

    // Floating cyber dust particles
    particles.forEach(p => {
      p.y -= p.speedY;
      if (p.y < 0) {
        p.y = h;
        p.x = Math.random() * w;
      }
      bgCtx.fillStyle = `${p.color} ${p.alpha})`;
      bgCtx.beginPath();
      bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      bgCtx.fill();
    });

    // Radial impact shockwaves on trauma
    if (cameraTrauma > 0.05) {
      bgCtx.save();
      const shockRadius = (1 - cameraTrauma) * 450 + 80;
      bgCtx.strokeStyle = `rgba(244, 63, 94, ${cameraTrauma * 0.5})`;
      bgCtx.lineWidth = 3;
      bgCtx.beginPath();
      bgCtx.arc(w / 2, h / 2, shockRadius, 0, Math.PI * 2);
      bgCtx.stroke();
      bgCtx.restore();
    }
  }

  // --- Main Render Frame Engine ---
  function renderFrame(t) {
    // 1. Timecode HUD display
    if (hudTimecode) {
      const mins = Math.floor(t / 60).toString().padStart(2, '0');
      const secs = Math.floor(t % 60).toString().padStart(2, '0');
      const frames = Math.floor((t % 1) * FPS).toString().padStart(2, '0');
      hudTimecode.textContent = `${mins}:${secs}:${frames}`;
    }

    // 2. Determine current active scene
    const currentScene = SCENES.find(s => t >= s.start && t < s.end) || SCENES[SCENES.length - 1];
    const sceneTime = t - currentScene.start;

    // Toggle active class on scene layers
    SCENES.forEach(s => {
      const el = sceneEls[s.id];
      if (el) {
        if (s.id === currentScene.id) {
          el.classList.add('is-active');
        } else {
          el.classList.remove('is-active');
        }
      }
    });

    // 3. Ambient glow color update
    if (ambientGlow) {
      ambientGlow.style.background = `radial-gradient(circle at center, ${currentScene.glow} 0%, rgba(6, 182, 212, 0.04) 50%, rgba(0,0,0,0) 80%)`;
    }

    // 4. Camera Trauma Decay & Shake
    let shakeX = 0;
    let shakeY = 0;
    let shakeRot = 0;
    if (cameraTrauma > 0.001) {
      const amp = cameraTrauma * 16;
      shakeX = (Math.random() - 0.5) * amp;
      shakeY = (Math.random() - 0.5) * amp;
      shakeRot = (Math.random() - 0.5) * cameraTrauma * 2.5;
      cameraTrauma = Math.max(0, cameraTrauma - 0.04);
    }

    // 5. Dynamic 3D Camera Rig Position
    let camZ = 0;
    let camRotX = 0;
    let camRotY = 0;
    let camScale = 1.0;
    let camTransX = 0;
    let camTransY = 0;

    if (currentScene.id === 'scene-1') {
      // Scene 1: Floating cinematic drift, snap punch on "YOU NEVER CHECKED HOW"
      const floatX = Math.sin(t * 1.5) * 1.2;
      const floatY = Math.cos(t * 1.2) * 1.0;
      camRotX = floatX;
      camRotY = floatY;
      if (t >= 2.0 && t <= 2.8) {
        camScale = 1.05; // Punch zoom
      }
    } else if (currentScene.id === 'scene-2') {
      // Scene 2: Camera zooms directly onto `it.skip` at line 22!
      if (t >= 6.8 && t < 8.8) {
        // Dramatic camera zoom in onto row-target-skip
        const zoomP = easeOutCubic(clamp((t - 6.8) / 0.5, 0, 1));
        camScale = lerp(1.0, 1.22, zoomP);
        camTransX = lerp(0, -12, zoomP);
        camTransY = lerp(0, 32, zoomP);
        camRotX = lerp(0, 3, zoomP);
      } else if (t >= 8.8) {
        // Camera smoothly resets back to frame the entire window & infraction stack
        const pullP = easeOutCubic(clamp((t - 8.8) / 0.8, 0, 1));
        camScale = lerp(1.22, 1.0, pullP);
        camTransX = lerp(-12, 0, pullP);
        camTransY = lerp(32, 0, pullP);
        camRotX = lerp(3, 1, pullP);
      }
    } else if (currentScene.id === 'scene-3') {
      // Scene 3: Clean perspective tilt
      camRotX = 2.5;
      camScale = 1.0;
    } else if (currentScene.id === 'scene-4') {
      // Scene 4: Centered focus, high-impact shake on stamp
      camRotX = 1.5;
      if (t >= 22.8 && t < 23.4) {
        camScale = 1.04;
      }
    } else if (currentScene.id === 'scene-5') {
      // Scene 5: Outro slight pull back
      camScale = 0.98;
      camRotX = Math.sin(t * 1.2) * 0.8;
    }

    if (sceneCamera) {
      sceneCamera.style.transform = `
        translate3d(${camTransX + shakeX}px, ${camTransY + shakeY}px, ${camZ}px)
        rotateX(${camRotX}deg)
        rotateY(${camRotY}deg)
        rotateZ(${shakeRot}deg)
        scale(${camScale})
      `;
    }

    // 6. Sub-Element Micro-Animations per Scene

    // --- SCENE 1 ---
    if (currentScene.id === 'scene-1') {
      // Line 1: YOUR AI AGENT
      const p1 = clamp(sceneTime / 0.6, 0, 1);
      if (kline1) {
        kline1.style.opacity = p1;
        kline1.style.transform = `scale(${lerp(0.85, 1.0, easeOutCubic(p1))}) translateY(${lerp(20, 0, easeOutCubic(p1))}px)`;
      }

      // Line 2: MADE CI GREEN
      const p2 = clamp((sceneTime - 0.7) / 0.6, 0, 1);
      if (kline2) {
        kline2.style.opacity = p2;
        kline2.style.transform = `scale(${lerp(0.85, 1.0, easeOutCubic(p2))}) translateY(${lerp(20, 0, easeOutCubic(p2))}px)`;
      }

      // Box 3: YOU NEVER CHECKED HOW
      const p3 = clamp((sceneTime - 1.9) / 0.4, 0, 1);
      if (kbox3) {
        kbox3.style.opacity = p3;
        kbox3.style.transform = `scale(${lerp(1.4, 1.0, springProgress(p3))})`;
      }

      // Subline
      const pSub = clamp((sceneTime - 2.8) / 0.6, 0, 1);
      if (hookSubline) {
        hookSubline.style.opacity = pSub;
      }
    }

    // --- SCENE 2 ---
    if (currentScene.id === 'scene-2') {
      // Code window enter
      if (codeWindow) {
        const pw = clamp(sceneTime / 0.6, 0, 1);
        codeWindow.style.opacity = pw;
        codeWindow.style.transform = `rotateX(4deg) scale(${lerp(0.94, 0.98, easeOutCubic(pw))})`;
      }

      // Target reticle lock on line 22
      if (targetReticle) {
        if (t >= 7.0 && t <= 9.2) {
          targetReticle.style.opacity = '1';
          targetReticle.style.transform = 'scale(1)';
        } else {
          targetReticle.style.opacity = '0';
          targetReticle.style.transform = 'scale(1.3)';
        }
      }

      // Staggered Infraction Pills
      const animatePill = (el, startTime) => {
        if (!el) return;
        const pp = clamp((t - startTime) / 0.45, 0, 1);
        el.style.opacity = pp;
        el.style.transform = `translateX(${lerp(-25, 0, easeOutCubic(pp))}px)`;
      };

      animatePill(pill1, 7.6);
      animatePill(pill2, 8.8);
      animatePill(pill3, 10.0);
    }

    // --- SCENE 3 ---
    if (currentScene.id === 'scene-3') {
      // Typewriter command: $ npx agent-roast
      const fullCmd = 'npx agent-roast';
      const typeStart = 13.2;
      const typeDuration = 1.0;
      if (auditCmdText) {
        if (t < typeStart) {
          auditCmdText.textContent = '';
        } else {
          const typeProgress = clamp((t - typeStart) / typeDuration, 0, 1);
          const chars = Math.floor(typeProgress * fullCmd.length);
          auditCmdText.textContent = fullCmd.slice(0, chars);
        }
      }

      // Staggered Terminal Feed Items
      const feedTimes = [14.6, 15.3, 16.0, 16.7];
      feedItems.forEach((item, idx) => {
        const itemStart = feedTimes[idx] || 15.0;
        const pf = clamp((t - itemStart) / 0.35, 0, 1);
        item.style.opacity = pf;
        item.style.transform = `translateY(${lerp(8, 0, easeOutCubic(pf))}px)`;
      });

      // Staggered Specs Grid Tiles
      const specTimes = [17.5, 18.4, 19.3];
      specTiles.forEach((tile, idx) => {
        const tileStart = specTimes[idx] || 18.0;
        const pt = clamp((t - tileStart) / 0.4, 0, 1);
        tile.style.opacity = pt;
        tile.style.transform = `scale(${lerp(0.9, 1.0, springProgress(pt))})`;
      });
    }

    // --- SCENE 4 ---
    if (currentScene.id === 'scene-4') {
      // Score Gauge Sweep: 0 to 48
      const sweepStart = 20.9;
      const sweepDuration = 1.6;
      const gaugeP = clamp((t - sweepStart) / sweepDuration, 0, 1);
      const targetScore = 48;
      const currentScore = Math.round(lerp(0, targetScore, easeOutCubic(gaugeP)));

      if (scoreCounter) {
        scoreCounter.textContent = currentScore;
      }

      if (gaugeArc) {
        // SVG circle stroke-dasharray is 515. Offset 515 = 0%, offset 267.8 = 48%
        const circumference = 515;
        const offset = circumference - (circumference * (currentScore / 100));
        gaugeArc.style.strokeDashoffset = offset;
      }

      // Verdict Stamp Slam at 22.8s
      if (verdictStamp) {
        if (t < 22.8) {
          verdictStamp.style.opacity = '0';
          verdictStamp.style.transform = 'scale(1.8)';
        } else {
          const stampP = clamp((t - 22.8) / 0.3, 0, 1);
          verdictStamp.style.opacity = '1';
          verdictStamp.style.transform = `scale(${lerp(1.7, 1.0, springProgress(stampP))})`;
        }
      }

      // Exact Line Proof Card at 23.8s
      if (proofCard) {
        const pp = clamp((t - 23.8) / 0.45, 0, 1);
        proofCard.style.opacity = pp;
        proofCard.style.transform = `translateY(${lerp(15, 0, easeOutCubic(pp))}px)`;
      }

      // CI Gate Blocked Card at 25.0s
      if (ciGateCard) {
        const pg = clamp((t - 25.0) / 0.4, 0, 1);
        ciGateCard.style.opacity = pg;
        ciGateCard.style.transform = `scale(${lerp(0.92, 1.0, springProgress(pg))})`;
      }
    }

    // --- SCENE 5 ---
    if (currentScene.id === 'scene-5') {
      if (outroCmd) {
        const pc = clamp((t - 28.0) / 0.4, 0, 1);
        outroCmd.style.opacity = pc;
        outroCmd.style.transform = `scale(${lerp(0.9, 1.0, springProgress(pc))})`;
      }

      if (outroCiBox) {
        const pci = clamp((t - 29.2) / 0.45, 0, 1);
        outroCiBox.style.opacity = pci;
      }

      if (outroMeta) {
        const pm = clamp((t - 30.0) / 0.5, 0, 1);
        outroMeta.style.opacity = pm;
      }
    }

    // 7. Render 3D Background Canvas
    renderBackgroundCanvas(t);

    // 8. Update Studio Timeline & Time Display
    const pct = (t / DURATION) * 100;
    if (timelineProgress) timelineProgress.style.width = `${pct}%`;
    if (timelinePlayhead) timelinePlayhead.style.left = `${pct}%`;

    if (timeDisplay) {
      const curSecs = Math.floor(t);
      const curMilli = Math.floor((t % 1) * 10);
      const totalSecs = Math.floor(DURATION);
      timeDisplay.textContent = `00:${curSecs.toString().padStart(2, '0')}.${curMilli} / 00:${totalSecs.toString().padStart(2, '0')}`;
    }

    // Update active scene jumper button
    scJumpButtons.forEach(btn => {
      const btnTime = parseFloat(btn.getAttribute('data-time') || '0');
      const isCur = currentScene.start === btnTime || (btnTime <= t && t < (btnTime + 5.5));
      if (isCur) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    // 9. Sound FX & Audio Sync
    triggerSFXAt(t);
    syncVoiceover(t);
  }

  // --- Animation Loop ---
  function animationTick(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const delta = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (isPlaying) {
      currentTime += delta;
      if (currentTime >= DURATION) {
        currentTime = DURATION;
        pauseVideo();
      }
    }

    renderFrame(currentTime);

    if (isPlaying || cameraTrauma > 0.001) {
      requestAnimationFrame(animationTick);
    }
  }

  // --- Playback Controls ---
  function playVideo() {
    initAudio();
    ensureAudioContextRunning();
    if (currentTime >= DURATION) {
      seekTo(0);
    }
    isPlaying = true;
    lastTimestamp = performance.now();
    btnPlay.classList.add('is-playing');
    requestAnimationFrame(animationTick);
  }

  function pauseVideo() {
    isPlaying = false;
    btnPlay.classList.remove('is-playing');
    pauseAllVoiceovers();
  }

  function togglePlay() {
    if (isPlaying) {
      pauseVideo();
    } else {
      playVideo();
    }
  }

  function seekTo(targetTime) {
    currentTime = clamp(targetTime, 0, DURATION);
    firedSFX.clear(); // Reset fired SFX history for new seek position
    // Mark prior SFX as fired so they don't instantly burst
    if (currentTime >= 2.1) firedSFX.add('s1-kbox');
    if (currentTime >= 5.7) firedSFX.add('s2-whoosh');
    if (currentTime >= 7.1) firedSFX.add('s2-target');
    if (currentTime >= 7.9) firedSFX.add('s2-pill1');
    if (currentTime >= 9.5) firedSFX.add('s2-pill2');
    if (currentTime >= 11.1) firedSFX.add('s2-pill3');
    if (currentTime >= 13.1) firedSFX.add('s3-whoosh');
    if (currentTime >= 20.9) firedSFX.add('s4-whoosh');
    if (currentTime >= 22.9) firedSFX.add('s4-stamp');
    if (currentTime >= 23.9) firedSFX.add('s4-proof');
    if (currentTime >= 25.1) firedSFX.add('s4-gate');
    if (currentTime >= 27.1) firedSFX.add('s5-whoosh');

    renderFrame(currentTime);
  }

  // --- UI Event Listeners ---
  if (btnPlay) btnPlay.addEventListener('click', togglePlay);
  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      seekTo(0);
      playVideo();
    });
  }

  // Scene Jump Buttons
  scJumpButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const timeVal = parseFloat(btn.getAttribute('data-time') || '0');
      seekTo(timeVal);
      if (!isPlaying) playVideo();
    });
  });

  // Timeline scrubber click & drag
  if (timelineTrack) {
    let isDragging = false;

    const handleScrub = (e) => {
      const rect = timelineTrack.getBoundingClientRect();
      const clickX = clamp(e.clientX - rect.left, 0, rect.width);
      const ratio = clickX / rect.width;
      seekTo(ratio * DURATION);
    };

    timelineTrack.addEventListener('mousedown', (e) => {
      isDragging = true;
      handleScrub(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) handleScrub(e);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // Voiceover Selector Toggle: EN Neural -> RU Neural -> Muted -> EN Neural
  if (btnAudioToggle) {
    btnAudioToggle.addEventListener('click', () => {
      initAudio();
      pauseAllVoiceovers();
      if (currentVoice === 'en') {
        currentVoice = 'ru';
        btnAudioToggle.classList.add('active');
        if (audioStatusLabel) audioStatusLabel.textContent = 'Voiceover: RU Neural';
      } else if (currentVoice === 'ru') {
        currentVoice = 'muted';
        btnAudioToggle.classList.remove('active');
        if (audioStatusLabel) audioStatusLabel.textContent = 'Voiceover: MUTED';
      } else {
        currentVoice = 'en';
        btnAudioToggle.classList.add('active');
        if (audioStatusLabel) audioStatusLabel.textContent = 'Voiceover: EN Neural';
      }
      renderFrame(currentTime);
    });
  }

  // Test Bass Drop SFX Button
  if (btnSoundTest) {
    btnSoundTest.addEventListener('click', () => {
      initAudio();
      playVerdictStamp();
      cameraTrauma = 0.8;
      renderFrame(currentTime);
    });
  }

  // Aspect Ratio Toggle: 9:16 Vertical Phone Reel vs 16:9 Presentation
  if (btnAspect) {
    btnAspect.addEventListener('click', () => {
      isLandscape = !isLandscape;
      if (phoneFrame) {
        if (isLandscape) {
          phoneFrame.classList.add('landscape');
        } else {
          phoneFrame.classList.remove('landscape');
        }
      }
    });
  }

  // Spacebar and Arrow Key Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      seekTo(currentTime + 1.0);
    } else if (e.code === 'ArrowLeft') {
      seekTo(currentTime - 1.0);
    }
  });

  // --- Video Recording / Export Engine ---
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      exportVideoReel();
    });
  }

  function exportVideoReel() {
    initAudio();
    ensureAudioContextRunning();

    if (!window.MediaRecorder) {
      alert('MediaRecorder is not supported in this browser. Please use Chrome, Edge, or Safari 15+.');
      return;
    }

    // Prepare recording stream from background canvas + web audio
    const canvasStream = bgCanvas.captureStream(60);
    let combinedStream = canvasStream;

    if (streamDest && streamDest.stream.getAudioTracks().length > 0) {
      const audioTrack = streamDest.stream.getAudioTracks()[0];
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        audioTrack
      ]);
    }

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = '';
      }
    }

    const recordedChunks = [];
    const recorder = mimeType ? new MediaRecorder(combinedStream, { mimeType }) : new MediaRecorder(combinedStream);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-roast-reel-${currentVoice}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (btnExport) {
        btnExport.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
          <span>Downloaded!</span>
        `;
        setTimeout(() => {
          btnExport.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 2v9m0 0l-3-3m3 3l3-3M2 13h12"/></svg>
            <span>Export MP4 / WebM</span>
          `;
        }, 3000);
      }
    };

    // Begin synchronous render from t=0
    seekTo(0);
    recorder.start();
    playVideo();

    if (btnExport) {
      btnExport.innerHTML = `
        <span class="rec-dot"></span>
        <span>Recording Reel...</span>
      `;
    }

    // Monitor for completion
    const exportCheck = setInterval(() => {
      if (!isPlaying || currentTime >= DURATION) {
        clearInterval(exportCheck);
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }
    }, 200);
  }

  // --- Initialize First Frame ---
  renderFrame(0);

  // Auto-init audio on first user touch / click anywhere on window
  const initAudioOnce = () => {
    initAudio();
    window.removeEventListener('pointerdown', initAudioOnce);
  };
  window.addEventListener('pointerdown', initAudioOnce);

})();
