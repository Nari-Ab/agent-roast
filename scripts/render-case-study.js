import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const width = 880;
const height = 480;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");

// Terminal Color Palette (GitHub Dark Pro)
const C_BG = "#0d1117";
const C_TITLEBAR = "#161b22";
const C_BORDER = "#30363d";
const C_TEXT = "#c9d1d9";
const C_MUTED = "#8b949e";
const C_CYAN = "#58a6ff";
const C_GREEN = "#3fb950";
const C_YELLOW = "#d29922";
const C_ORANGE = "#ffa657";
const C_RED = "#ff7b72";
const C_MAGENTA = "#bc8cff";

function drawWindow() {
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(16, 12, width - 32, height - 24, 10);
  ctx.fillStyle = C_BG;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = C_BORDER;
  ctx.stroke();
  ctx.clip();

  // Title bar
  ctx.fillStyle = C_TITLEBAR;
  ctx.fillRect(16, 12, width - 32, 36);
  ctx.beginPath();
  ctx.moveTo(16, 48);
  ctx.lineTo(width - 16, 48);
  ctx.strokeStyle = C_BORDER;
  ctx.stroke();

  // Traffic lights
  ctx.fillStyle = "#ff5f56";
  ctx.beginPath();
  ctx.arc(38, 30, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffbd2e";
  ctx.beginPath();
  ctx.arc(58, 30, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#27c93f";
  ctx.beginPath();
  ctx.arc(78, 30, 6, 0, Math.PI * 2);
  ctx.fill();

  // Title text
  ctx.fillStyle = C_MUTED;
  ctx.font = "500 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("terminal — npx agent-roast", width / 2, 34);
  ctx.restore();
}

const command = "npx agent-roast";
const lines = [
  { t: "agent-roast — git discipline audit (304 AI commits in Soup)", bold: true, color: "#ffffff" },
  { t: "  commits: 304 AI / 1,153 total    lines added: 87,165 AI / 479,097 total", color: C_MUTED },
  { t: "" },
  { t: "  SCORE: 55 / 100  ·  The Panic Looper", bold: true, color: C_ORANGE },
  { t: "  Prone to rapid-fire fix and revert thrashing cycles when wrestling bugs.", italic: true, color: C_MUTED },
  { t: "" },
  { t: "  INFRACTIONS (42)", bold: true, color: "#ffffff" },
  { t: "  ──────────────────────────────────────────────────────────", color: C_BORDER },
  { t: "  ● panic-loop (15)  consecutive quick fixes < 15m apart", color: C_MAGENTA },
  { t: "      AI panic loop: consecutive quick fix within 2m (4890709 -> 5bce6f0)", color: C_MUTED },
  { t: "  ● type-escape (19)  compiler bypasses (as any, @ts-ignore)", color: C_YELLOW },
  { t: "      src/soup_cli/utils/safe_regex.py: import sre_constants as _c  # type: ignore", color: C_MUTED },
  { t: "  ● test-skip (6)  skipped or disabled tests", color: C_RED },
  { t: "      tests/test_outbound.py: pytest.skip(\"httpx refuses spelling outright\")", color: C_MUTED },
  { t: "  ● swallowed-error (2)  empty catch blocks or except: pass", color: C_RED },
  { t: "      src/soup_cli/ui/static/app.js: try { sessionStorage.setItem(...) } catch (e) {}", color: C_MUTED },
];

const gif = GIFEncoder();
const frames = [];

// Phase 1: Typing command (8 frames)
for (let i = 0; i <= command.length; i += 3) {
  drawWindow();
  ctx.textAlign = "left";
  ctx.font = "600 13px Menlo, Monaco, Consolas, monospace";
  ctx.fillStyle = C_GREEN;
  ctx.fillText("$ ", 36, 75);

  ctx.fillStyle = "#ffffff";
  const typed = command.slice(0, i);
  ctx.fillText(typed, 50, 75);

  const tw = ctx.measureText(typed).width;
  ctx.fillStyle = C_MUTED;
  ctx.fillRect(52 + tw, 62, 8, 15);

  frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay: 100 });
}

// Phase 2: Progress (2 frames)
drawWindow();
ctx.textAlign = "left";
ctx.font = "600 13px Menlo, Monaco, Consolas, monospace";
ctx.fillStyle = C_GREEN;
ctx.fillText("$ ", 36, 75);
ctx.fillStyle = "#ffffff";
ctx.fillText(command, 50, 75);
ctx.fillStyle = C_CYAN;
ctx.fillText("⠋ Scanning git history (1,153 commits)...", 36, 98);
frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay: 180 });

// Phase 3: Reveal clean report
for (let lineCount = 1; lineCount <= lines.length; lineCount += 2) {
  drawWindow();
  ctx.textAlign = "left";
  ctx.font = "600 13px Menlo, Monaco, Consolas, monospace";
  ctx.fillStyle = C_GREEN;
  ctx.fillText("$ ", 36, 75);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(command, 50, 75);

  let startY = 100;
  for (let l = 0; l < lineCount; l++) {
    const item = lines[l];
    const y = startY + l * 20;

    if (!item.t) continue;

    ctx.font = item.bold
      ? "700 13px Menlo, Monaco, Consolas, monospace"
      : item.italic
      ? "italic 12px Menlo, Monaco, Consolas, monospace"
      : "400 13px Menlo, Monaco, Consolas, monospace";

    ctx.fillStyle = item.color;
    ctx.fillText(item.t, 36, y);
  }

  frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay: 120 });
}

// Final hold frame (4 seconds)
frames[frames.length - 1].delay = 4000;

console.log(`Encoding ${frames.length} frames to GIF...`);
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const palette = quantize(f.data, 256);
  const index = applyPalette(f.data, palette);
  gif.writeFrame(index, width, height, { palette, delay: f.delay });
}

gif.finish();
fs.writeFileSync("docs/assets/case-study.gif", gif.bytes());
console.log("docs/assets/case-study.gif updated cleanly!");
