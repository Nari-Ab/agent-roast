import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import vm from "vm";

const source = readFileSync("site/main.js", "utf8");
const html = readFileSync("site/index.html", "utf8");
const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("public adoption examples", () => {
  it("offers current-code checking as the copyable first step", () => {
    expect(html).toContain('data-copy="npx agent-roast check"');
    expect(html).not.toContain('data-copy="npx agent-roast"');
    expect(html).not.toMatch(/range:|v0\.2\.1|200ms|zero-dependency/);
  });
  it("keeps the displayed and copied Action workflow identical and uses supported inputs", () => {
    const copied = decode(/data-copy="(name: Agent Roast[\s\S]*?)" data-select="ci-yaml-code"/.exec(html)![1]);
    const displayed = decode(/id="ci-yaml-code"><code>([\s\S]*?)<\/code>/.exec(html)![1]);
    expect(copied).toBe(displayed);
    expect(copied).toContain("contents: read"); expect(copied).toContain("fetch-depth: 0");
    expect(copied).toContain("mode: review"); expect(copied).toContain("github.event.pull_request.base.sha");
    expect(copied).not.toContain("range:"); expect(copied).not.toContain("pull_request_target");
  });
  it("identifies demo results as illustrative and avoids guarantees about merging or performance", () => {
    expect(html).toContain("Illustrative examples, not customer results or live execution");
    expect(source).not.toMatch(/\b\d+ms\b|Ready to merge|Spotless discipline/);
    expect(html).toContain("false positives");
  });
  it.each([false, true])("handles clipboard success=%s without a silent rejected promise", async success => {
    const listeners = new Map<string, () => Promise<void>>();
    let ready: () => void = () => {};
    let selected = false;
    const label = { textContent: "Copy", setAttribute() {} };
    const classes = new Set<string>();
    const button = {
      getAttribute: (name: string) => name === "data-copy" ? "npx agent-roast check" : "install-cmd",
      querySelector: () => label,
      classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
      addEventListener: (name: string, callback: () => Promise<void>) => listeners.set(name, callback),
    };
    const context = {
      document: {
        addEventListener: (_: string, callback: () => void) => { ready = callback; },
        querySelectorAll: (selector: string) => selector === ".copy-btn" ? [button] : [],
        getElementById: (id: string) => id === "install-cmd" ? { textContent: "npx agent-roast check" } : null,
        createRange: () => ({ selectNodeContents() { selected = true; } }),
      },
      navigator: { clipboard: { writeText: async (value: string) => { expect(value).toBe("npx agent-roast check"); if (!success) throw new Error("Clipboard denied"); } } },
      window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
      setTimeout() {},
    };
    vm.runInNewContext(source, context); ready(); await listeners.get("click")!();
    expect(label.textContent).toBe(success ? "Copied" : "Copy manually");
    expect(selected).toBe(!success); expect(classes.has("is-copied")).toBe(success);
  });
});
