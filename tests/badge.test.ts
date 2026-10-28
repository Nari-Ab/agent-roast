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

describe("badge output treats labels as text", () => {
  it("escapes XML attribute and element injection including controls", () => {
    const svg = generateSvgBadge(92, '\"><script>alert(1)</script>&\u001b\u202e');
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('\u001b'); expect(svg).not.toContain('\u202e');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;\\u001b\\u202e');
    expect((svg.match(/<svg\b/g) || []).length).toBe(1);
  });
  it("keeps markdown labels inert and encodes destination delimiters", () => {
    const markdown = generateShieldsMarkdown(88, 'x](![image](https://evil.invalid))\n<a> &', 'https://example.invalid/repo(a)');
    expect(markdown).not.toContain('![image]'); expect(markdown).not.toContain('<a>');
    expect(markdown.split('\n')).toHaveLength(1);
    expect(markdown).toContain('https://example.invalid/repo%28a%29');
    expect(generateShieldsMarkdown(88, 'my-label_name')).toContain('/my--label__name-88');
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'https://user:secret@example.invalid'])('refuses unsafe badge destinations %s', destination => {
    expect(() => generateShieldsMarkdown(88, 'label', destination)).toThrow(/HTTP/);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 101])('does not label an invalid score %s as a valid rating', score => {
    expect(generateSvgBadge(score)).toContain('N/A');
    expect(generateShieldsJson(score).message).toBe('N/A');
    expect(getScoreColor(score).name).toBe('lightgrey');
  });
});


it("normalizes Unicode line separators in SVG and Markdown badge labels", () => {
  for (const rendered of [generateSvgBadge(90, "a\u2028b\u2029c"), generateShieldsMarkdown(90, "a\u2028b\u2029c")]) {
    expect(rendered).not.toContain("\u2028"); expect(rendered).not.toContain("\u2029");
    expect(rendered).toContain("u2028"); expect(rendered).toContain("u2029");
  }
});
