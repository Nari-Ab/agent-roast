import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const width = 880;
const height = 540;
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

// Helper to draw the window chrome
function drawWindow() {
  // Clear background
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, width, height);

  // Terminal box with rounded corners
  const rad = 12;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(16, 12, width - 32, height - 24, rad);
  ctx.fillStyle = C_BG;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = C_BORDER;
  ctx.stroke();
  ctx.clip();

  // Title bar
  ctx.fillStyle = C_TITLEBAR;
  ctx.fillRect(16, 12, width - 32, 38);
  ctx.beginPath();
  ctx.moveTo(16, 50);
  ctx.lineTo(width - 16, 50);
  ctx.strokeStyle = C_BORDER;
  ctx.stroke();

  // Traffic light dots
  ctx.fillStyle = "#ff5f56";
  ctx.beginPath();
  ctx.arc(38, 31, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffbd2e";
  ctx.beginPath();
  ctx.arc(58, 31, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#27c93f";
  ctx.beginPath();
  ctx.arc(78, 31, 6, 0, Math.PI * 2);
  ctx.fill();

  // Title text
  ctx.fillStyle = C_MUTED;
  ctx.font = "500 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("terminal — npx agent-roast --verbose", width / 2, 35);
  ctx.restore();
}

// Storyboard sequence
const command = "npx agent-roast --verbose";
const lines = [
  { t: "╔══════════════════════════════════════════════════════════╗", color: C_CYAN, bold: true },
  { t: "║                 🤖 AGENT ROAST DOSSIER                    ║", color: "#ffffff", bold: true, subCyan: true },
  { t: "╚══════════════════════════════════════════════════════════╝", color: C_CYAN, bold: true },
  { t: "" },
  { t: "  Repository:  Soup", color: C_TEXT, boldKey: "Repository:" },
  { t: "  Commits:     304 AI-attributed / 1,153 total", color: C_TEXT, valColor: C_YELLOW },
  { t: "  Code Added:  87,165 lines (AI) / 479,097 lines (total)", color: C_TEXT, valColor: C_GREEN },
  { t: "" },
  { t: "  AGENT ARCHETYPE:  The Panic Looper", color: C_MAGENTA, bold: true, leadWhite: "  AGENT ARCHETYPE:  " },
  { t: "  Prone to rapid-fire fix and revert thrashing cycles when wrestling bugs.", color: C_MUTED, italic: true },
  { t: "" },
  { t: "  DISCIPLINE SCORE: 55 / 100", color: C_ORANGE, bold: true, leadWhite: "  DISCIPLINE SCORE: " },
  { t: "  (100 = spotless discipline, 0 = complete shortcut addiction)", color: C_MUTED },
  { t: "" },
  { t: "  📊 INFRACTIONS BREAKDOWN:", color: "#ffffff", bold: true },
  { t: "  ✖  Skipped tests:       6 (it.skip, describe.skip, xit)", color: C_RED, bold: true },
  { t: "  ▲  Type escapes:        19 (as any, @ts-ignore, eslint-disable)", color: C_YELLOW },
  { t: "  ✖  Swallowed errors:    2 (empty catch {}, except: pass)", color: C_RED },
  { t: "  ↻  Panic fix loops:     15 (quick fixes < 15m apart)", color: C_MAGENTA },
  { t: "" },
  { t: "  🔍 VERBOSE PROOFS (First items):", color: "#ffffff", bold: true },
  { t: "  • 5c335b9 [test-skip] tests/test_outbound.py └─ pytest.skip(\"refused\")", color: C_MUTED },
  { t: "  • a910f21 [panic-loop] AI panic loop: fix within 3m (3df29a1 -> a910f21)", color: C_MUTED },
];

const gif = GIFEncoder();
const frames = [];

// Phase 1: Typing command (12 frames)
for (let i = 0; i <= command.length; i += 2) {
  drawWindow();
  ctx.textAlign = "left";
  ctx.font = "600 13px Menlo, Monaco, 'Courier New', monospace";
  ctx.fillStyle = C_GREEN;
  ctx.fillText("$ ", 36, 75);

  ctx.fillStyle = "#ffffff";
  const typed = command.slice(0, i);
  ctx.fillText(typed, 50, 75);

  const tw = ctx.measureText(typed).width;
  ctx.fillStyle = C_MUTED;
  ctx.fillRect(52 + tw, 62, 8, 15);

  frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay: 90 });
}

// Phase 2: Enter pressed, spinner (3 frames)
const spinners = ["⠋ Scanning git history (1,153 commits)...", "⠙ Analyzing diff chunks and AI signatures...", "✔ Audit complete (210ms)"];
for (const s of spinners) {
  drawWindow();
  ctx.textAlign = "left";
  ctx.font = "600 13px Menlo, Monaco, 'Courier New', monospace";
  ctx.fillStyle = C_GREEN;
  ctx.fillText("$ ", 36, 75);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(command, 50, 75);

  ctx.fillStyle = C_CYAN;
  ctx.fillText(s, 36, 100);

  frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay: 180 });
}

// Phase 3: Printing the card line by line
for (let lineCount = 1; lineCount <= lines.length; lineCount += 2) {
  drawWindow();
  ctx.textAlign = "left";
  ctx.font = "600 13px Menlo, Monaco, 'Courier New', monospace";
  ctx.fillStyle = C_GREEN;
  ctx.fillText("$ ", 36, 75);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(command, 50, 75);

  let startY = 105;
  for (let l = 0; l < lineCount; l++) {
    const item = lines[l];
    const y = startY + l * 18;

    if (!item.t) continue;

    ctx.font = item.bold
      ? "700 13px Menlo, Monaco, 'Courier New', monospace"
      : item.italic
      ? "italic 12px Menlo, Monaco, 'Courier New', monospace"
      : "400 13px Menlo, Monaco, 'Courier New', monospace";

    if (item.subCyan) {
      ctx.fillStyle = C_CYAN;
      ctx.fillText("║", 36, y);
      ctx.fillStyle = item.color;
      ctx.fillText("                 🤖 AGENT ROAST DOSSIER                    ", 36, y);
      ctx.fillStyle = C_CYAN;
      ctx.fillText("                                                          ║", 36, y);
    } else if (item.leadWhite) {
      ctx.fillStyle = "#ffffff";
      ctx.fillText(item.leadWhite, 36, y);
      const wLead = ctx.measureText(item.leadWhite).width;
      ctx.fillStyle = item.color;
      ctx.fillText(item.t.replace(item.leadWhite, ""), 36 + wLead, y);
    } else {
      ctx.fillStyle = item.color;
      ctx.fillText(item.t, 36, y);
    }
  }

  frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay: 100 });
}

// Final hold frame (pause for 4 seconds so viewer can read)
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
console.log("docs/assets/case-study.gif created successfully!");
