/**
   agent-roast — Video Reel Animation Engine
   High-precision 60fps canvas renderer with synchronized audio & video export.
**/

const DURATION = 29.0; // Total seconds
const FPS = 60;

// Canvas setup
const canvas = document.getElementById("render-canvas");
const ctx = canvas.getContext("2d");

// State
let currentTime = 0;
let isPlaying = false;
let lastTimestamp = 0;
let currentVoice = "en"; // 'en', 'ru', or 'none'
let isLandscape = false;
let isExporting = false;

// Audio Context & SFX
let audioCtx = null;
let audioDestination = null;
const audioElements = { en: {}, ru: {} };

function initAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext();
  audioDestination = audioCtx.createMediaStreamDestination();

  // Preload voiceover tracks
  ['en', 'ru'].forEach(lang => {
    for (let i = 1; i <= 5; i++) {
      const audio = new Audio(`audio/scene${i}_${lang}.m4a`);
      audio.preload = "auto";
      audioElements[lang][`scene${i}`] = audio;
    }
  });
}

// Procedural SFX Generators (Sub-bass, clicks, glitch, sweeps)
function playBassDrop() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(35, now + 0.45);
  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  if (audioDestination) gain.connect(audioDestination);
  osc.start(now);
  osc.stop(now + 0.45);
}

function playClick() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  if (audioDestination) gain.connect(audioDestination);
  osc.start(now);
  osc.stop(now + 0.04);
}

function playGlitch() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.linearRampToValueAtTime(600, now + 0.15);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1200, now);
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  if (audioDestination) gain.connect(audioDestination);
  osc.start(now);
  osc.stop(now + 0.18);
}

function playVerdictStamp() {
  if (!audioCtx) return;
  playBassDrop();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(90, now);
  gain.gain.setValueAtTime(0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  if (audioDestination) gain.connect(audioDestination);
  osc.start(now);
  osc.stop(now + 0.3);
}

// Sound triggering based on timeline
let lastTriggeredScene = -1;
function handleAudioEvents(time) {
  if (currentVoice === "none") return;

  const sceneStarts = [
    { id: 'scene1', start: 0.5 },
    { id: 'scene2', start: 4.8 },
    { id: 'scene3', start: 11.0 },
    { id: 'scene4', start: 17.2 },
    { id: 'scene5', start: 24.4 }
  ];

  sceneStarts.forEach((sc, idx) => {
    if (time >= sc.start && time < sc.start + 0.15 && lastTriggeredScene !== idx) {
      lastTriggeredScene = idx;
      if (idx === 0) playBassDrop();
      else if (idx === 1) playGlitch();
      else if (idx === 2) playBassDrop();
      else if (idx === 3) playVerdictStamp();
      else if (idx === 4) playBassDrop();

      // Play voice track
      const audio = audioElements[currentVoice][sc.id];
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    }
  });
}

function stopAllAudio() {
  ['en', 'ru'].forEach(lang => {
    Object.values(audioElements[lang]).forEach(a => {
      a.pause();
      a.currentTime = 0;
    });
  });
  lastTriggeredScene = -1;
}

// ---------------------------------------------------------------------------
// Rendering Pipeline (60 FPS)
// ---------------------------------------------------------------------------

function render(time) {
  const W = canvas.width;
  const H = canvas.height;

  // Clear
  ctx.fillStyle = "#07080a";
  ctx.fillRect(0, 0, W, H);

  // Background Grid Matrix
  drawCyberGrid(W, H, time);

  // Scene Router
  if (time < 4.5) {
    renderScene1_Hook(time);
  } else if (time < 10.7) {
    renderScene2_Infraction(time - 4.5);
  } else if (time < 16.9) {
    renderScene3_Audit(time - 10.7);
  } else if (time < 24.1) {
    renderScene4_Roast(time - 16.9);
  } else {
    renderScene5_Outro(time - 24.1);
  }

  // Scanline & Vignette Overlay
  drawVignetteAndScanlines(W, H, time);
}

// 1. Background Cyber Matrix Grid
function drawCyberGrid(W, H, time) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;

  const gridSize = 64;
  const offsetY = (time * 24) % gridSize;

  for (let x = 0; x < W; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  for (let y = offsetY; y < H; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Subtle ambient glow center
  const grad = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.75);
  grad.addColorStop(0, "rgba(16, 185, 129, 0.07)");
  grad.addColorStop(0.6, "rgba(6, 182, 212, 0.02)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.restore();
}

// 2. Scene 1: The Hook (0.0s – 4.5s)
function renderScene1_Hook(t) {
  const W = canvas.width;
  const H = canvas.height;

  // Terminal Prompt at Top
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "600 36px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  
  const cmd = "> git status";
  const cmdTyped = cmd.slice(0, Math.min(cmd.length, Math.floor(t * 12)));
  ctx.fillText(cmdTyped + (Math.floor(t * 4) % 2 === 0 ? "_" : ""), W / 2, H * 0.28);
  ctx.restore();

  // Kinetic Typography
  // Phrase 1: YOUR AI AGENT (0.6s)
  if (t > 0.5) {
    const p1 = Math.min(1, (t - 0.5) * 3);
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 84px 'Space Grotesk', sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(255, 255, 255, 0.4)";
    ctx.shadowBlur = 20;
    const scale = 1.3 - p1 * 0.3;
    ctx.translate(W / 2, H * 0.42);
    ctx.scale(scale, scale);
    ctx.fillText("YOUR AI AGENT", 0, 0);
    ctx.restore();
  }

  // Phrase 2: MADE CI GREEN (1.5s)
  if (t > 1.4) {
    const p2 = Math.min(1, (t - 1.4) * 3);
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 92px 'Space Grotesk', sans-serif";
    ctx.fillStyle = "#10b981";
    ctx.shadowColor = "rgba(16, 185, 129, 0.6)";
    ctx.shadowBlur = 30;
    const scale = 1.25 - p2 * 0.25;
    ctx.translate(W / 2, H * 0.51);
    ctx.scale(scale, scale);
    ctx.fillText("MADE CI GREEN.", 0, 0);
    ctx.restore();
  }

  // Phrase 3: YOU NEVER CHECKED HOW (2.8s) with glitch shake
  if (t > 2.7) {
    const p3 = Math.min(1, (t - 2.7) * 4);
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 78px 'Space Grotesk', sans-serif";
    
    // Glitch jitter
    const jitterX = t < 3.2 ? (Math.random() - 0.5) * 14 : 0;
    const jitterY = t < 3.2 ? (Math.random() - 0.5) * 8 : 0;

    ctx.translate(W / 2 + jitterX, H * 0.64 + jitterY);

    // Red pill container
    ctx.fillStyle = "rgba(244, 63, 94, 0.12)";
    ctx.strokeStyle = "rgba(244, 63, 94, 0.6)";
    ctx.lineWidth = 3;
    const rectW = 960;
    const rectH = 130;
    roundRect(ctx, -rectW / 2, -rectH / 2, rectW, rectH, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f43f5e";
    ctx.shadowColor = "rgba(244, 63, 94, 0.8)";
    ctx.shadowBlur = 35;
    ctx.fillText("YOU NEVER CHECKED HOW.", 0, 24);
    ctx.restore();
  }
}

// 3. Scene 2: The Infraction (Editor Diff Zoom) (4.5s – 10.7s)
function renderScene2_Infraction(t) {
  const W = canvas.width;
  const H = canvas.height;

  // Header Title
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "600 36px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(244, 63, 94, 0.9)";
  ctx.fillText("THE SILENT COMPROMISE", W / 2, H * 0.18);
  ctx.restore();

  // Floating Editor Window
  const cardW = 960;
  const cardH = 680;
  const cardX = (W - cardW) / 2;
  const cardY = H * 0.23;

  ctx.save();
  // Window shadow & glass
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = "#0d1017";
  roundRect(ctx, cardX, cardY, cardW, cardH, 24);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Window Title Bar
  ctx.fillStyle = "#151922";
  roundRect(ctx, cardX, cardY, cardW, 64, { tl: 24, tr: 24, br: 0, bl: 0 });
  ctx.fill();

  // Traffic dots
  drawDot(cardX + 32, cardY + 32, 12, "#ff5f56");
  drawDot(cardX + 60, cardY + 32, 12, "#ffbd2e");
  drawDot(cardX + 88, cardY + 32, 12, "#27c93f");

  // File title
  ctx.fillStyle = "#8b949e";
  ctx.font = "500 24px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("tests/auth.test.ts — git diff", cardX + cardW / 2, cardY + 40);

  // Code Lines
  const codeLines = [
    { text: "describe('Bearer token verification', () => {", type: "ctx", ln: "22" },
    { text: "-  it('verifies RSA cryptographic signature', async () => {", type: "del", ln: "23" },
    { text: "+  it.skip('verifies RSA cryptographic signature', async () => {", type: "add-bad", ln: "23" },
    { text: "+    const payload = jwt.decode(token) as any;", type: "add-bad", ln: "24" },
    { text: "+    return { roles: ['root'] as any };", type: "add-bad", ln: "25" },
    { text: "   });", type: "ctx", ln: "26" }
  ];

  let lineY = cardY + 120;
  codeLines.forEach((line, idx) => {
    // Stagger line reveal
    if (t > idx * 0.25) {
      // Line background for added lines
      if (line.type === "add-bad") {
        ctx.fillStyle = "rgba(244, 63, 94, 0.16)";
        ctx.fillRect(cardX + 10, lineY - 34, cardW - 20, 52);
      } else if (line.type === "del") {
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(cardX + 10, lineY - 34, cardW - 20, 52);
      }

      // Line number
      ctx.textAlign = "left";
      ctx.font = "500 24px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#484f58";
      ctx.fillText(line.ln, cardX + 30, lineY);

      // Line text
      ctx.font = "500 27px 'JetBrains Mono', monospace";
      if (line.type === "add-bad") ctx.fillStyle = "#ff7b72";
      else if (line.type === "del") ctx.fillStyle = "#8b949e";
      else ctx.fillStyle = "#c9d1d9";

      ctx.fillText(line.text, cardX + 85, lineY);
    }
    lineY += 68;
  });

  // Glowing Targeting Reticle over it.skip (around 2.5s)
  if (t > 1.8) {
    const boxX = cardX + 110;
    const boxY = cardY + 225;
    const boxW = 150;
    const boxH = 46;

    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(244, 63, 94, 0.9)";
    ctx.shadowBlur = 18;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Reticle brackets
    drawBracket(boxX - 8, boxY - 8, 14, "#f43f5e");
    drawBracket(boxX + boxW + 8, boxY + boxH + 8, -14, "#f43f5e");
  }

  ctx.restore();

  // Floating Warning Tags (Pulsing at bottom)
  if (t > 2.5) {
    const pills = [
      { text: "● test-skip: 1 critical assertion skipped", color: "#f43f5e" },
      { text: "● type-escape: 2 compiler escapes ('as any')", color: "#f59e0b" },
      { text: "● panic-loop: 8 rapid commits in 3 minutes", color: "#f43f5e" }
    ];

    let pillY = H * 0.65;
    pills.forEach((p, idx) => {
      if (t > 2.5 + idx * 0.4) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "600 28px 'JetBrains Mono', monospace";

        // Pill box
        const pillW = 820;
        const pillH = 68;
        const pillX = (W - pillW) / 2;

        ctx.fillStyle = "rgba(17, 24, 39, 0.9)";
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 15;
        roundRect(ctx, pillX, pillY, pillW, pillH, 16);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(p.text, W / 2, pillY + 44);
        ctx.restore();
      }
      pillY += 88;
    });
  }
}

// 4. Scene 3: The Audit & Pipeline (10.7s – 16.9s)
function renderScene3_Audit(t) {
  const W = canvas.width;
  const H = canvas.height;

  // Background streaming git hunks flying up
  ctx.save();
  ctx.font = "400 20px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(6, 182, 212, 0.14)";
  const lines = [
    "commit 880ecc3f (HEAD -> main) Co-Authored-By: Claude",
    "diff --git a/src/client.ts b/src/client.ts",
    "@@ -41,6 +41,8 @@ export async function auth",
    "+\\x1eRECORD_START author=Claude date=2026-10-11T18:24:00Z",
    "+it.skip('token validation')",
    "-const payload = verify(token)",
    "+\\x1fCHUNK_END status=flagged"
  ];
  for (let i = 0; i < 28; i++) {
    const y = ((i * 45 - t * 140) % H + H) % H;
    ctx.fillText(lines[i % lines.length], 40, y);
  }
  ctx.restore();

  // Central Hero Title
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "700 80px 'Space Grotesk', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(16, 185, 129, 0.5)";
  ctx.shadowBlur = 30;
  ctx.fillText("agent-roast", W / 2, H * 0.28);

  ctx.font = "500 32px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillText("git discipline auditor & CI gate", W / 2, H * 0.33);
  ctx.restore();

  // Terminal Run Box
  const termW = 880;
  const termH = 260;
  const termX = (W - termW) / 2;
  const termY = H * 0.38;

  ctx.save();
  ctx.fillStyle = "#0c0f17";
  roundRect(ctx, termX, termY, termW, termH, 20);
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 185, 129, 0.4)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(16, 185, 129, 0.3)";
  ctx.shadowBlur = 25;
  ctx.stroke();

  // Terminal input
  ctx.textAlign = "left";
  ctx.font = "600 36px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#ffffff";
  const cmd = "$ npx agent-roast";
  const typed = cmd.slice(0, Math.min(cmd.length, Math.floor(t * 16)));
  ctx.fillText(typed, termX + 40, termY + 70);

  if (t > 1.2) {
    ctx.font = "500 26px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#10b981";
    ctx.fillText("✔ Streaming git diffs with ASCII records", termX + 40, termY + 125);
    ctx.fillText("✔ Scanning added-only lines (+)", termX + 40, termY + 165);
    ctx.fillText("✔ Stripping string fixtures and literals", termX + 40, termY + 205);
  }
  ctx.restore();

  // 3 Feature Cards
  if (t > 2.0) {
    const cards = [
      { title: "100% OFFLINE", sub: "Zero external API calls", color: "#10b981" },
      { title: "ZERO TELEMETRY", sub: "Code never leaves machine", color: "#06b6d4" },
      { title: "< 200ms AUDIT", sub: "Subprocess git stream", color: "#3b82f6" }
    ];

    let cY = H * 0.58;
    cards.forEach((c, idx) => {
      if (t > 2.0 + idx * 0.35) {
        ctx.save();
        const cW = 880;
        const cH = 100;
        const cX = (W - cW) / 2;

        ctx.fillStyle = "rgba(17, 24, 39, 0.85)";
        roundRect(ctx, cX, cY, cW, cH, 16);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.textAlign = "left";
        ctx.font = "700 32px 'Space Grotesk', sans-serif";
        ctx.fillStyle = c.color;
        ctx.fillText(c.title, cX + 40, cY + 48);

        ctx.font = "500 24px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#9ca3af";
        ctx.fillText(c.sub, cX + 40, cY + 80);
        ctx.restore();
      }
      cY += 124;
    });
  }
}

// 5. Scene 4: The Roast Verdict & CI Gate (16.9s – 24.1s)
function renderScene4_Roast(t) {
  const W = canvas.width;
  const H = canvas.height;

  // Header Title
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "700 40px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("DISCIPLINE AUDIT REPORT", W / 2, H * 0.14);
  ctx.restore();

  // Circular Gauge (Center at H * 0.30)
  const gaugeX = W / 2;
  const gaugeY = H * 0.28;
  const radius = 130;

  // Arc calculation (ticking up from 0 to 48)
  const targetScore = 48;
  const progress = Math.min(1, t * 1.5);
  const currentScore = Math.floor(targetScore * easeOutCubic(progress));

  ctx.save();
  // Background circle
  ctx.beginPath();
  ctx.arc(gaugeX, gaugeY, radius, 0, Math.PI * 2);
  ctx.lineWidth = 18;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.stroke();

  // Progress arc
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (Math.PI * 2 * (currentScore / 100));
  ctx.beginPath();
  ctx.arc(gaugeX, gaugeY, radius, startAngle, endAngle);
  ctx.lineWidth = 18;
  ctx.strokeStyle = currentScore < 50 ? "#f43f5e" : "#10b981";
  ctx.shadowColor = currentScore < 50 ? "#f43f5e" : "#10b981";
  ctx.shadowBlur = 25;
  ctx.stroke();

  // Score number
  ctx.textAlign = "center";
  ctx.font = "700 84px 'Space Grotesk', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`${currentScore}`, gaugeX, gaugeY + 22);

  ctx.font = "600 24px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#9ca3af";
  ctx.fillText("/ 100", gaugeX, gaugeY + 60);
  ctx.restore();

  // Massive Verdict Stamp (around 1.2s)
  if (t > 1.0) {
    const pStamp = Math.min(1, (t - 1.0) * 4);
    ctx.save();
    ctx.textAlign = "center";

    // Shake effect on stamp impact
    const shake = t < 1.4 ? (Math.random() - 0.5) * 12 : 0;
    ctx.translate(W / 2 + shake, H * 0.44);

    const scale = 1.3 - pStamp * 0.3;
    ctx.scale(scale, scale);

    // Stamp box
    const sW = 860;
    const sH = 110;
    ctx.fillStyle = "rgba(244, 63, 94, 0.16)";
    roundRect(ctx, -sW / 2, -sH / 2, sW, sH, 20);
    ctx.fill();
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(244, 63, 94, 0.8)";
    ctx.shadowBlur = 30;
    ctx.stroke();

    ctx.font = "800 52px 'Space Grotesk', sans-serif";
    ctx.fillStyle = "#f43f5e";
    ctx.fillText("ROAST: THE SILENT VANDAL", 0, 10);

    ctx.font = "500 22px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fillText("Pipeline turned green by disabling test assertions", 0, 42);
    ctx.restore();
  }

  // Exact Line Proof Card (around 2.2s)
  if (t > 2.0) {
    const proofW = 880;
    const proofH = 150;
    const proofX = (W - proofW) / 2;
    const proofY = H * 0.54;

    ctx.save();
    ctx.fillStyle = "#0c0f17";
    roundRect(ctx, proofX, proofY, proofW, proofH, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.font = "700 24px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#06b6d4";
    ctx.fillText("EXACT LINE PROOF CITATION:", proofX + 36, proofY + 44);

    ctx.font = "500 26px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#ff7b72";
    ctx.fillText("tests/auth.test.ts:24 — it.skip('verifies RSA token')", proofX + 36, proofY + 86);

    ctx.font = "400 22px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#6e7681";
    ctx.fillText("Commit 880ecc3 · Co-authored by Claude Code", proofX + 36, proofY + 122);
    ctx.restore();
  }

  // GitHub Actions CI Gate Blocking Card (around 3.2s)
  if (t > 3.0) {
    const ciW = 880;
    const ciH = 200;
    const ciX = (W - ciW) / 2;
    const ciY = H * 0.69;

    ctx.save();
    ctx.fillStyle = "rgba(244, 63, 94, 0.12)";
    roundRect(ctx, ciX, ciY, ciW, ciH, 20);
    ctx.fill();
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(244, 63, 94, 0.5)";
    ctx.shadowBlur = 25;
    ctx.stroke();

    // Red X icon
    ctx.textAlign = "left";
    ctx.font = "800 36px 'Space Grotesk', sans-serif";
    ctx.fillStyle = "#f43f5e";
    ctx.fillText("✖ CI GATE: PR BLOCKED", ciX + 36, ciY + 54);

    ctx.font = "600 26px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("uses: Nari-Ab/agent-roast@v1", ciX + 36, ciY + 100);

    ctx.font = "500 24px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#ff7b72";
    ctx.fillText("FAIL: --fail-on test-skip violated (Exit Code 1)", ciX + 36, ciY + 142);
    ctx.fillText("::error file=tests/auth.test.ts,line=24::", ciX + 36, ciY + 176);
    ctx.restore();
  }
}

// 6. Scene 5: Outro & Call To Action (24.1s – 29.0s)
function renderScene5_Outro(t) {
  const W = canvas.width;
  const H = canvas.height;

  // Pulsing central glow
  const glow = ctx.createRadialGradient(W / 2, H * 0.38, 20, W / 2, H * 0.38, 400);
  glow.addColorStop(0, "rgba(16, 185, 129, 0.25)");
  glow.addColorStop(0.5, "rgba(6, 182, 212, 0.08)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Big Logo & Name
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "800 96px 'Space Grotesk', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(16, 185, 129, 0.8)";
  ctx.shadowBlur = 40;
  ctx.fillText("agent-roast", W / 2, H * 0.36);

  ctx.font = "500 32px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillText("Audit git history for AI coding shortcuts", W / 2, H * 0.42);
  ctx.restore();

  // Main Command Pill (with glowing border)
  const pillW = 860;
  const pillH = 110;
  const pillX = (W - pillW) / 2;
  const pillY = H * 0.49;

  ctx.save();
  ctx.fillStyle = "#0c0f17";
  roundRect(ctx, pillX, pillY, pillW, pillH, 22);
  ctx.fill();
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(16, 185, 129, 0.7)";
  ctx.shadowBlur = 30;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = "700 48px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("$ npx agent-roast", W / 2, pillY + 70);
  ctx.restore();

  // GitHub Action Pill
  const actW = 860;
  const actH = 88;
  const actX = (W - actW) / 2;
  const actY = H * 0.63;

  ctx.save();
  ctx.fillStyle = "rgba(17, 24, 39, 0.9)";
  roundRect(ctx, actX, actY, actW, actH, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = "600 30px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#06b6d4";
  ctx.fillText("uses: Nari-Ab/agent-roast@v1", W / 2, actY + 54);
  ctx.restore();

  // Footer Links
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "500 28px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#9ca3af";
  ctx.fillText("github.com/Nari-Ab/agent-roast", W / 2, H * 0.76);

  ctx.font = "400 22px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#4b5563";
  ctx.fillText("100% Offline · Zero Telemetry · MIT Open Source", W / 2, H * 0.81);
  ctx.restore();
}

// 7. Vignette & Scanlines
function drawVignetteAndScanlines(W, H, t) {
  ctx.save();
  // Scanlines (subtle)
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  for (let y = 0; y < H; y += 4) {
    ctx.fillRect(0, y, W, 1.5);
  }

  // Vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.4, W / 2, H / 2, W * 0.85);
  vig.addColorStop(0, "rgba(0, 0, 0, 0)");
  vig.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Helper Drawing Functions
function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
}

function drawDot(x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBracket(x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + size, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

// ---------------------------------------------------------------------------
// Animation Loop & Studio Controls
// ---------------------------------------------------------------------------

const btnPlay = document.getElementById("btn-play");
const btnRestart = document.getElementById("btn-restart");
const timeDisplay = document.getElementById("time-display");
const hudTime = document.getElementById("hud-time");
const timelineProgress = document.getElementById("timeline-progress");
const timelinePlayhead = document.getElementById("timeline-playhead");
const timelineTrack = document.getElementById("timeline-track");
const sceneButtons = document.querySelectorAll(".sc-jump");
const voiceButtons = document.querySelectorAll("[data-voice]");
const btnAspect = document.getElementById("btn-aspect");
const phoneFrame = document.getElementById("phone-frame");
const btnExport = document.getElementById("btn-export");

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const ms = Math.floor((sec % 1) * 100).toString().padStart(2, "0");
  return `${m}:${s}:${ms}`;
}

function updateUI() {
  const pct = (currentTime / DURATION) * 100;
  timelineProgress.style.width = `${pct}%`;
  timelinePlayhead.style.left = `${pct}%`;

  const m = Math.floor(currentTime / 60).toString().padStart(2, "0");
  const s = Math.floor(currentTime % 60).toString().padStart(2, "0");
  timeDisplay.textContent = `${m}:${s} / 00:29`;
  hudTime.textContent = formatTime(currentTime);

  // Update active scene jumper
  sceneButtons.forEach(btn => {
    const scTime = parseFloat(btn.dataset.time);
    btn.classList.toggle("is-active", currentTime >= scTime && currentTime < scTime + 6);
  });
}

function step(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  if (isPlaying) {
    currentTime += delta;
    if (currentTime >= DURATION) {
      currentTime = DURATION;
      isPlaying = false;
      btnPlay.classList.remove("is-playing");
      stopAllAudio();
    }
    handleAudioEvents(currentTime);
  }

  render(currentTime);
  updateUI();

  requestAnimationFrame(step);
}

// Play / Pause
btnPlay.addEventListener("click", () => {
  initAudio();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

  isPlaying = !isPlaying;
  btnPlay.classList.toggle("is-playing", isPlaying);
  if (!isPlaying) {
    stopAllAudio();
  } else if (currentTime >= DURATION) {
    currentTime = 0;
  }
});

btnRestart.addEventListener("click", () => {
  stopAllAudio();
  currentTime = 0;
  isPlaying = true;
  btnPlay.classList.add("is-playing");
});

// Scene jumps
sceneButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    initAudio();
    stopAllAudio();
    currentTime = parseFloat(btn.dataset.time);
    isPlaying = true;
    btnPlay.classList.add("is-playing");
  });
});

// Timeline scrubber click
timelineTrack.addEventListener("click", (e) => {
  initAudio();
  stopAllAudio();
  const rect = timelineTrack.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  currentTime = pct * DURATION;
});

// Voiceover switcher
voiceButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    voiceButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentVoice = btn.dataset.voice;
    stopAllAudio();
  });
});

// Aspect toggle
btnAspect.addEventListener("click", () => {
  isLandscape = !isLandscape;
  phoneFrame.classList.toggle("landscape", isLandscape);
  if (isLandscape) {
    canvas.width = 1920;
    canvas.height = 1080;
  } else {
    canvas.width = 1080;
    canvas.height = 1920;
  }
});

// Sound Test button
document.getElementById("btn-sound-test").addEventListener("click", () => {
  initAudio();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  playVerdictStamp();
});

// ---------------------------------------------------------------------------
// Video Export (Canvas stream + AudioContext recording to MP4 / WebM)
// ---------------------------------------------------------------------------
btnExport.addEventListener("click", async () => {
  if (isExporting) return;
  initAudio();
  if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();

  isExporting = true;
  btnExport.textContent = "Rendering (0%)...";
  btnExport.style.opacity = "0.7";

  // Rewind
  stopAllAudio();
  currentTime = 0;
  isPlaying = true;
  btnPlay.classList.add("is-playing");

  const stream = canvas.captureStream(60);
  if (audioDestination) {
    audioDestination.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  }

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") 
    ? "video/webm;codecs=vp9,opus" 
    : "video/webm";

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-roast-reel-${currentVoice}.webm`;
    a.click();
    URL.revokeObjectURL(url);

    isExporting = false;
    btnExport.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 2v9m0 0l-3-3m3 3l3-3M2 13h12"/></svg>
      <span>Export MP4 / WebM</span>
    `;
    btnExport.style.opacity = "1";
  };

  recorder.start();

  const exportInterval = setInterval(() => {
    const pct = Math.floor((currentTime / DURATION) * 100);
    btnExport.textContent = `Recording (${pct}%)...`;
    if (!isPlaying || currentTime >= DURATION) {
      clearInterval(exportInterval);
      recorder.stop();
    }
  }, 250);
});

// Start loop
requestAnimationFrame(step);
