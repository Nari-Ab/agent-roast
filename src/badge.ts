export interface ShieldsEndpointResponse {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

/** SVG attributes and text share the same XML escaping boundary. */
function displayText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function xmlText(value: string): string {
  return displayText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function badgeScore(score: number | null): number | null {
  return score !== null && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export function getScoreColor(score: number | null): { name: string; hex: string } {
  score = badgeScore(score);
  if (score === null) {
    return { name: "lightgrey", hex: "#9f9f9f" };
  }
  if (score >= 90) return { name: "brightgreen", hex: "#4c1" };
  if (score >= 80) return { name: "green", hex: "#97ca00" };
  if (score >= 70) return { name: "yellowgreen", hex: "#a4a61d" };
  if (score >= 60) return { name: "yellow", hex: "#dfb317" };
  return { name: "red", hex: "#e05d44" };
}

export function generateSvgBadge(score: number | null, label: string = "AI Discipline"): string {
  score = badgeScore(score);
  const value = score !== null ? `${score}/100` : "N/A";
  const color = getScoreColor(score);
  const safeLabel = xmlText(label);

  // Approximate character widths for Verdana 11px
  const labelWidth = Math.round(label.length * 6.8 + 14);
  const valueWidth = Math.round(value.length * 7.2 + 14);
  const totalWidth = labelWidth + valueWidth;

  const labelX = Math.round(labelWidth / 2);
  const valueX = Math.round(labelWidth + valueWidth / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${safeLabel}: ${value}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color.hex}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 14) * 10}">${safeLabel}</text>
    <text x="${labelX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 14) * 10}">${safeLabel}</text>
    <text aria-hidden="true" x="${valueX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueWidth - 14) * 10}">${value}</text>
    <text x="${valueX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(valueWidth - 14) * 10}">${value}</text>
  </g>
</svg>`;
}

export function generateShieldsMarkdown(
  score: number | null,
  label: string = "AI Discipline",
  repoUrl: string = "https://github.com/Nari-Ab/agent-roast"
): string {
  score = badgeScore(score);
  const value = score !== null ? `${score}%2F100` : "N%2FA";
  const color = getScoreColor(score);
  const shownLabel = displayText(label);
  // Shields uses doubled dashes/underscores for literal label punctuation.
  const encodedLabel = encodeURIComponent(shownLabel.replace(/-/g, "--").replace(/_/g, "__"));
  const alt = shownLabel.replace(/[\\[\]*_!`]/g, "\\$&").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const destination = new URL(repoUrl);
  if (!["https:", "http:"].includes(destination.protocol) || destination.username || destination.password) {
    throw new Error("Badge destination must be an HTTP(S) URL without credentials.");
  }
  const safeDestination = destination.href.replace(/[()\\]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const badgeUrl = `https://img.shields.io/badge/${encodedLabel}-${value}-${color.name}?style=flat-square`;

  return `[![${alt}](${badgeUrl})](${safeDestination})`;
}

export function generateShieldsJson(
  score: number | null,
  label: string = "AI Discipline"
): ShieldsEndpointResponse {
  score = badgeScore(score);
  const value = score !== null ? `${score}/100` : "N/A";
  const color = getScoreColor(score);

  return {
    schemaVersion: 1,
    label,
    message: value,
    color: color.name,
  };
}
