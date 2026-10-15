export interface ShieldsEndpointResponse {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

export function getScoreColor(score: number | null): { name: string; hex: string } {
  if (score === null || isNaN(score)) {
    return { name: "lightgrey", hex: "#9f9f9f" };
  }
  if (score >= 90) return { name: "brightgreen", hex: "#4c1" };
  if (score >= 80) return { name: "green", hex: "#97ca00" };
  if (score >= 70) return { name: "yellowgreen", hex: "#a4a61d" };
  if (score >= 60) return { name: "yellow", hex: "#dfb317" };
  return { name: "red", hex: "#e05d44" };
}

export function generateSvgBadge(score: number | null, label: string = "AI Discipline"): string {
  const value = score !== null && !isNaN(score) ? `${score}/100` : "N/A";
  const color = getScoreColor(score);

  // Approximate character widths for Verdana 11px
  const labelWidth = Math.round(label.length * 6.8 + 14);
  const valueWidth = Math.round(value.length * 7.2 + 14);
  const totalWidth = labelWidth + valueWidth;

  const labelX = Math.round(labelWidth / 2);
  const valueX = Math.round(labelWidth + valueWidth / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
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
    <text aria-hidden="true" x="${labelX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 14) * 10}">${label}</text>
    <text x="${labelX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 14) * 10}">${label}</text>
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
  const value = score !== null && !isNaN(score) ? `${score}%2F100` : "N%2FA";
  const color = getScoreColor(score);
  const encodedLabel = encodeURIComponent(label);
  const badgeUrl = `https://img.shields.io/badge/${encodedLabel}-${value}-${color.name}?style=flat-square`;

  return `[![${label}](${badgeUrl})](${repoUrl})`;
}

export function generateShieldsJson(
  score: number | null,
  label: string = "AI Discipline"
): ShieldsEndpointResponse {
  const value = score !== null && !isNaN(score) ? `${score}/100` : "N/A";
  const color = getScoreColor(score);

  return {
    schemaVersion: 1,
    label,
    message: value,
    color: color.name,
  };
}
