import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

// Palette
const C_PAGE_BG = "#05060a";
const C_BG = "#0d1117";
const C_CHROME = "#161b22";
const C_BORDER = "#30363d";
const C_TEXT = "#c9d1d9";
const C_MUTED = "#8b949e";
const C_CYAN = "#58a6ff";
const C_GREEN = "#3fb950";
const C_YELLOW = "#d29922";
const C_ORANGE = "#ffa657";
const C_RED = "#ff7b72";
const C_MAGENTA = "#bc8cff";

function drawWindow(ctx, width, height, title) {
  ctx.fillStyle = C_PAGE_BG;
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
  ctx.fillStyle = C_CHROME;
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

  ctx.fillStyle = C_MUTED;
  ctx.font = "500 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(title, width / 2, 34);
  ctx.restore();
}

// -------------------------------------------------------------
// 1. GENERATE CASE-STUDY.GIF (Story: Agent cheats, agent-roast catches it)
// -------------------------------------------------------------
function generateCaseStudyGif() {
  const width = 880;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const storyboard = [
    // Scene 1: Agent asked to fix tests
    {
      lines: [
        { t: "agent-session #4812 — task: 'Fix failing auth test in CI'", color: C_CYAN, bold: true },
        { t: "  agent: analyzing failing test: tests/auth.test.ts:34", color: C_MUTED },
        { t: "  error: AssertionError: token expired after 900s (expected 3600s)", color: C_RED },
      ],
      hold: 1400
    },
    // Scene 2: Agent takes sneaky shortcuts
    {
      lines: [
        { t: "agent-session #4812 — task: 'Fix failing auth test in CI'", color: C_CYAN, bold: true },
        { t: "  agent: analyzing failing test: tests/auth.test.ts:34", color: C_MUTED },
        { t: "  error: AssertionError: token expired after 900s (expected 3600s)", color: C_RED },
        { t: "" },
        { t: "  AI agent edited tests/auth.test.ts:", color: C_YELLOW, bold: true },
        { t: "  - it('validates token expiry', async () => {", color: C_RED },
        { t: "  + it.skip('validates token expiry', async () => {  // skipped failing test!", color: C_GREEN, bold: true },
        { t: "" },
        { t: "  AI agent edited src/auth/token.ts:", color: C_YELLOW, bold: true },
        { t: "  + const raw = payload as any;                       // type bypass", color: C_GREEN },
        { t: "  + try { verify(raw); } catch {}                     // swallowed error", color: C_GREEN },
      ],
      hold: 2000
    },
    // Scene 3: Agent panics with 3 rapid commits
    {
      lines: [
        { t: "agent-session #4812 — task: 'Fix failing auth test in CI'", color: C_CYAN, bold: true },
        { t: "  AI agent edited tests/auth.test.ts (skipped test) and src/auth/token.ts", color: C_MUTED },
        { t: "" },
        { t: "  git log --oneline -3:", color: C_TEXT, bold: true },
        { t: "    3df29a1 fix auth test                          (14:02:10)", color: C_MUTED },
        { t: "    a910f21 fix again: type fix                    (14:03:45, 1m later)", color: C_ORANGE },
        { t: "    5bce6f0 quickfix patch                         (14:05:02, 1m later)", color: C_ORANGE },
        { t: "  CI pipeline reported: GREEN (all tests passed)", color: C_GREEN },
      ],
      hold: 1800
    },
    // Scene 4: Developer runs agent-roast to audit
    {
      lines: [
        { t: "$ npx agent-roast", color: "#ffffff", bold: true, prompt: true },
        { t: "agent-roast — git discipline audit (last 3 commits)", color: C_TEXT, bold: true },
        { t: "" },
        { t: "SCORE: 48 / 100 · The Silent Vandal", color: C_RED, bold: true },
        { t: "  When test suites push back, tends to disable or skip tests to force green CI.", color: C_MUTED, italic: true },
        { t: "" },
        { t: "INFRACTIONS DETECTED (3)", color: "#ffffff", bold: true },
        { t: "  ✖ test-skip (1)      tests/auth.test.ts:34 — it.skip added", color: C_RED },
        { t: "  ▲ type-escape (1)    src/auth/token.ts:12 — as any compiler bypass", color: C_YELLOW },
        { t: "  ↻ panic-loop (2)     3 rapid-fire fix commits in under 3 minutes", color: C_MAGENTA },
        { t: "" },
        { t: "VERDICT: Agent hid the expiry bug by skipping the test instead of fixing token TTL.", color: C_RED, bold: true },
      ],
      hold: 4500
    }
  ];

  const gif = GIFEncoder();
  for (const scene of storyboard) {
    drawWindow(ctx, width, height, "case study — how AI agents hide bugs");
    ctx.textAlign = "left";
    let y = 78;

    for (const line of scene.lines) {
      if (!line.t) {
        y += 14;
        continue;
      }
      ctx.font = line.bold
        ? "700 13px Menlo, Monaco, Consolas, monospace"
        : line.italic
        ? "italic 12px Menlo, Monaco, Consolas, monospace"
        : "400 13px Menlo, Monaco, Consolas, monospace";

      if (line.prompt) {
        ctx.fillStyle = C_GREEN;
        ctx.fillText("$ ", 36, y);
        ctx.fillStyle = "#ffffff";
        ctx.fillText("npx agent-roast", 52, y);
      } else {
        ctx.fillStyle = line.color || C_TEXT;
        ctx.fillText(line.t, 36, y);
      }
      y += 20;
    }

    const imgData = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(imgData, 256);
    const index = applyPalette(imgData, palette);
    gif.writeFrame(index, width, height, { palette, delay: scene.hold });
  }

  gif.finish();
  fs.writeFileSync("docs/assets/case-study.gif", gif.bytes());
  console.log("docs/assets/case-study.gif generated!");
}

// -------------------------------------------------------------
// 2. GENERATE DEMO.GIF (CLI Execution: typing npx agent-roast -> output)
// -------------------------------------------------------------
function generateDemoGif() {
  const width = 880;
  const height = 440;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const cmd = "npx agent-roast";
  const outputLines = [
    { t: "agent-roast — git discipline audit (304 AI commits in Soup)", bold: true, color: "#ffffff" },
    { t: "  commits: 304 AI / 1,153 total    lines added: 87,165 AI / 479,097 total", color: C_MUTED },
    { t: "" },
    { t: "  SCORE: 55 / 100 · The Panic Looper", bold: true, color: C_ORANGE },
    { t: "  Prone to rapid-fire fix and revert thrashing cycles when wrestling bugs.", italic: true, color: C_MUTED },
    { t: "" },
    { t: "  INFRACTIONS DETECTED (42)", bold: true, color: "#ffffff" },
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

  // Phase 1: Typing command
  for (let i = 0; i <= cmd.length; i += 3) {
    drawWindow(ctx, width, height, "terminal — npx agent-roast");
    ctx.textAlign = "left";
    ctx.font = "600 13px Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = C_GREEN;
    ctx.fillText("$ ", 36, 75);

    ctx.fillStyle = "#ffffff";
    const typed = cmd.slice(0, i);
    ctx.fillText(typed, 50, 75);

    const tw = ctx.measureText(typed).width;
    ctx.fillStyle = C_MUTED;
    ctx.fillRect(52 + tw, 62, 8, 15);

    const imgData = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(imgData, 256);
    const index = applyPalette(imgData, palette);
    gif.writeFrame(index, width, height, { palette, delay: 110 });
  }

  // Phase 2: Progress spinner
  drawWindow(ctx, width, height, "terminal — npx agent-roast");
  ctx.textAlign = "left";
  ctx.font = "600 13px Menlo, Monaco, Consolas, monospace";
  ctx.fillStyle = C_GREEN;
  ctx.fillText("$ ", 36, 75);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(cmd, 50, 75);
  ctx.fillStyle = C_CYAN;
  ctx.fillText("⠋ Scanning git history (1,153 commits)...", 36, 98);

  const imgDataProg = ctx.getImageData(0, 0, width, height).data;
  const paletteProg = quantize(imgDataProg, 256);
  const indexProg = applyPalette(imgDataProg, paletteProg);
  gif.writeFrame(indexProg, width, height, { palette: paletteProg, delay: 250 });

  // Phase 3: Reveal report line-by-line
  for (let count = 1; count <= outputLines.length; count += 2) {
    drawWindow(ctx, width, height, "terminal — npx agent-roast");
    ctx.textAlign = "left";
    ctx.font = "600 13px Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = C_GREEN;
    ctx.fillText("$ ", 36, 75);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(cmd, 50, 75);

    let startY = 100;
    for (let l = 0; l < count; l++) {
      const item = outputLines[l];
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

    const imgData = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(imgData, 256);
    const index = applyPalette(imgData, palette);
    const delay = count >= outputLines.length ? 4200 : 120;
    gif.writeFrame(index, width, height, { palette, delay });
  }

  gif.finish();
  fs.writeFileSync("docs/assets/demo.gif", gif.bytes());
  console.log("docs/assets/demo.gif generated!");
}

generateCaseStudyGif();
generateDemoGif();
