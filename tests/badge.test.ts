import { describe, it, expect } from "vitest";
import {
  getScoreColor,
  generateSvgBadge,
  generateShieldsMarkdown,
  generateShieldsJson,
} from "../src/badge.js";

describe("Badge Generator", () => {
  it("computes correct badge color based on score threshold", () => {
    expect(getScoreColor(95).name).toBe("brightgreen");
    expect(getScoreColor(85).name).toBe("green");
    expect(getScoreColor(75).name).toBe("yellowgreen");
    expect(getScoreColor(65).name).toBe("yellow");
    expect(getScoreColor(40).name).toBe("red");
    expect(getScoreColor(null).name).toBe("lightgrey");
  });

  it("generates valid SVG badge", () => {
    const svg = generateSvgBadge(92, "AI Discipline");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("AI Discipline");
    expect(svg).toContain("92/100");
    expect(svg).toContain(getScoreColor(92).hex);
  });

  it("generates valid SVG badge for insufficient data (null score)", () => {
    const svg = generateSvgBadge(null, "AI Discipline");
    expect(svg).toContain("N/A");
    expect(svg).toContain(getScoreColor(null).hex);
  });

  it("generates Shields.io markdown snippet", () => {
    const md = generateShieldsMarkdown(88, "AI Discipline");
    expect(md).toContain("[![AI Discipline]");
    expect(md).toContain("https://img.shields.io/badge/AI%20Discipline-88%2F100-green");
    expect(md).toContain("https://github.com/Nari-Ab/agent-roast");
  });

  it("generates Shields.io JSON endpoint payload", () => {
    const json = generateShieldsJson(95, "AI Discipline");
    expect(json).toEqual({
      schemaVersion: 1,
      label: "AI Discipline",
      message: "95/100",
      color: "brightgreen",
    });
  });
});
