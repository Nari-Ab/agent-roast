import fs from "fs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

// Generate animated GIF simulating terminal typing and dossier reveal
const width = 640;
const height = 360;

// Simple software renderer for bitmap font / colored blocks
function createBuffer(w, h, bgColor) {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = bgColor[0];
    buf[i * 4 + 1] = bgColor[1];
    buf[i * 4 + 2] = bgColor[2];
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function fillRect(buf, w, x, y, rw, rh, color) {
  for (let dy = 0; dy < rh; dy++) {
    for (let dx = 0; dx < rw; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * w + px) * 4;
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = 255;
      }
    }
  }
}

// Draw simple 5x7 bitmap font
const FONT = {
  "$": [0x08, 0x3e, 0x28, 0x3e, 0x0a, 0x3e, 0x08],
  "n": [0x00, 0x1c, 0x12, 0x12, 0x12, 0x12, 0x00],
  "p": [0x00, 0x1c, 0x12, 0x1c, 0x10, 0x10, 0x00],
  "x": [0x00, 0x12, 0x0c, 0x0c, 0x12, 0x12, 0x00],
  " ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  "a": [0x00, 0x0e, 0x02, 0x1e, 0x12, 0x1e, 0x00],
  "g": [0x00, 0x1e, 0x12, 0x1e, 0x02, 0x1e, 0x00],
  "e": [0x00, 0x1e, 0x10, 0x1e, 0x10, 0x1e, 0x00],
  "t": [0x04, 0x1f, 0x04, 0x04, 0x04, 0x06, 0x00],
  "-": [0x00, 0x00, 0x1f, 0x00, 0x00, 0x00, 0x00],
  "r": [0x00, 0x16, 0x18, 0x10, 0x10, 0x10, 0x00],
  "o": [0x00, 0x0c, 0x12, 0x12, 0x12, 0x0c, 0x00],
  "s": [0x00, 0x0e, 0x10, 0x0c, 0x02, 0x1c, 0x00],
  "A": [0x0c, 0x12, 0x12, 0x1e, 0x12, 0x12, 0x00],
  "G": [0x0e, 0x10, 0x10, 0x16, 0x12, 0x0e, 0x00],
  "E": [0x1e, 0x10, 0x1c, 0x10, 0x10, 0x1e, 0x00],
  "N": [0x12, 0x16, 0x1a, 0x12, 0x12, 0x12, 0x00],
  "T": [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x00],
  "R": [0x1c, 0x12, 0x1c, 0x14, 0x12, 0x12, 0x00],
  "O": [0x0c, 0x12, 0x12, 0x12, 0x12, 0x0c, 0x00],
  "S": [0x0e, 0x10, 0x0c, 0x02, 0x12, 0x0c, 0x00],
  "D": [0x1c, 0x12, 0x12, 0x12, 0x12, 0x1c, 0x00],
  "I": [0x1c, 0x08, 0x08, 0x08, 0x08, 0x1c, 0x00],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x11, 0x0e, 0x00],
  "/": [0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x0e, 0x00],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x0e, 0x00],
  ":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  "=": [0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00, 0x00],
};

function drawChar(buf, w, x, y, char, color, scale = 2) {
  const glyph = FONT[char] || FONT[" "];
  for (let row = 0; row < 7; row++) {
    const bitRow = glyph[row];
    for (let col = 0; col < 5; col++) {
      if ((bitRow >> (4 - col)) & 1) {
        fillRect(buf, w, x + col * scale, y + row * scale, scale, scale, color);
      }
    }
  }
}

function drawText(buf, w, x, y, text, color, scale = 2) {
  let cx = x;
  for (const c of text) {
    drawChar(buf, w, cx, y, c, color, scale);
    cx += 6 * scale;
  }
}

function renderFrame(step) {
  const bg = [13, 17, 23];
  const bar = [22, 27, 34];
  const buf = createBuffer(width, height, bg);

  // Terminal window chrome
  fillRect(buf, width, 0, 0, width, 32, bar);
  fillRect(buf, width, 16, 11, 10, 10, [255, 95, 86]);
  fillRect(buf, width, 32, 11, 10, 10, [255, 189, 46]);
  fillRect(buf, width, 48, 11, 10, 10, [39, 201, 63]);

  // Step 1..4: typing "npx agent-roast"
  drawText(buf, width, 24, 48, "$", [126, 231, 135], 2);
  const fullCommand = "npx agent-roast";
  const typedCount = Math.min(fullCommand.length, Math.max(0, step * 3));
  const currentText = fullCommand.slice(0, typedCount);
  drawText(buf, width, 42, 48, currentText, [255, 255, 255], 2);

  // Blinking cursor
  if (step < 6) {
    if (step % 2 === 0) {
      fillRect(buf, width, 44 + typedCount * 12, 48, 8, 14, [139, 148, 158]);
    }
    return buf;
  }

  // Step 6+: Reveal Dossier Card
  const cyan = [88, 166, 255];
  const white = [255, 255, 255];
  const yellow = [255, 166, 87];
  const magenta = [210, 168, 255];
  const red = [255, 123, 114];
  const green = [126, 231, 135];

  // Box border
  drawText(buf, width, 24, 80, "==============================", cyan, 2);
  drawText(buf, width, 48, 102, "AGENT ROAST DOSSIER", white, 2);
  drawText(buf, width, 24, 124, "==============================", cyan, 2);

  // Metadata
  drawText(buf, width, 24, 154, "ARCHETYPE: The Panic Looper", magenta, 2);
  drawText(buf, width, 24, 184, "DISCIPLINE: 55 / 100", yellow, 2);

  // Infractions
  drawText(buf, width, 24, 220, "x Skipped tests: 6", red, 2);
  drawText(buf, width, 24, 246, "x Type escapes: 19", yellow, 2);
  drawText(buf, width, 24, 272, "x Swallowed errors: 2", red, 2);
  drawText(buf, width, 24, 298, "+ Panic fix loops: 15", magenta, 2);

  drawText(buf, width, 24, 330, "DONE in 180ms (zero telemetry)", green, 2);

  return buf;
}

const gif = GIFEncoder();
const totalFrames = 12;

for (let i = 0; i < totalFrames; i++) {
  const rgba = renderFrame(i);
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  const delay = i === totalFrames - 1 ? 2500 : (i >= 6 ? 400 : 250);
  gif.writeFrame(index, width, height, { palette, delay });
}

gif.finish();
fs.writeFileSync("docs/assets/demo.gif", gif.bytes());
console.log("demo.gif generated successfully!");
