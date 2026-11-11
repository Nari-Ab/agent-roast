import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { VALID_DETECTORS } from "../src/types.js";
import { RULE_GUIDES } from "../src/rules.js";

const read = (file: string) => readFileSync(file, "utf8");
const json = (file: string) => JSON.parse(read(file));
const version: string = json("package.json").version;

describe("every place that names the version agrees with package.json", () => {
  it("the Action installs the version being released", () => {
    expect(read("action.yml")).toContain(`npm install --prefix "$INSTALL_DIR" agent-roast@${version} `);
  });
  it("the Claude Code plugin and marketplace carry it, and the hook runs it", () => {
    expect(json("plugin/.claude-plugin/plugin.json").version).toBe(version);
    const [entry] = json(".claude-plugin/marketplace.json").plugins;
    expect(entry).toMatchObject({ name: "agent-roast", source: "./plugin", version });
    expect(json("plugin/.claude-plugin/plugin.json").name).toBe(entry.name);
    expect(read("plugin/hooks/hooks.json")).toContain(`npx --yes agent-roast@${version} hook run --agent claude`);
  });
  it("the Action has a name Marketplace accepts: it may not match a user or an organization, and `agent-roast` is one", () => {
    const name = /^name:\s*"?([^"\n]+)"?/m.exec(read("action.yml"))![1];
    expect(name.toLowerCase()).not.toBe("agent-roast");
    expect(name.length).toBeLessThanOrEqual(80);
  });
  it("the package lock agrees", () => {
    const lock = json("package-lock.json");
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);
  });
  it("the MCP registry entry names this package and version, and the package proves the name", () => {
    const entry = json("server.json");
    const pkg = json("package.json");
    expect(entry.version).toBe(version);
    expect(entry.packages).toEqual([expect.objectContaining({ registryType: "npm", identifier: pkg.name, version, transport: { type: "stdio" }, packageArguments: [{ type: "positional", value: "mcp" }] })]);
    expect(entry.name).toBe(pkg.mcpName);
    expect(entry.description.length).toBeLessThanOrEqual(100);
  });
  it.each(["README.md", "docs/integrations.md", "docs/reference.md", "site/index.html"])("%s pins no other version in an install command", file => {
    for (const match of read(file).matchAll(/agent-roast@(\d+\.\d+\.\d+)/g)) expect(match[1]).toBe(version);
  });
  it("the changelog has a dated entry for it", () => {
    expect(read("CHANGELOG.md")).toMatch(new RegExp(`^## ${version.replace(/\./g, "\\.")} — \\d{4}-\\d{2}-\\d{2}$`, "m"));
  });
});

describe("the documentation holds together", () => {
  const docs = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", ...readdirSync("docs").filter(name => name.endsWith(".md")).map(name => `docs/${name}`)];
  it.each(docs)("%s links only to files that exist", file => {
    const missing: string[] = [];
    for (const match of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const relative = decodeURIComponent(target.split("#")[0]);
      if (relative && !existsSync(path.join(path.dirname(file), relative))) missing.push(target);
    }
    expect(missing).toEqual([]);
  });
  it("the rules reference describes every rule that can be reported", () => {
    const text = read("docs/rules.md");
    for (const rule of VALID_DETECTORS.filter(name => name !== "panic-loop")) expect(text).toContain(`## ${rule}`);
  });
  it("every rule has guidance for `explain`", () => {
    for (const rule of VALID_DETECTORS) expect(RULE_GUIDES[rule].suggestion.length).toBeGreaterThan(10);
  });
  it("the false-positive form offers every reportable rule", () => {
    const form = read(".github/ISSUE_TEMPLATE/false-positive.yml");
    for (const rule of VALID_DETECTORS.filter(name => name !== "panic-loop")) expect(form).toContain(rule);
  });
  it("the pre-commit snippet in the integrations guide is valid YAML-shaped and pinned", () => {
    expect(read("docs/integrations.md")).toContain(`additional_dependencies: ["agent-roast@${version}"]`);
  });
});

describe("the package ships what users need and nothing else", () => {
  it("publishes dist, README, LICENSE and the editor schema only", () => {
    expect(json("package.json").files).toEqual(["dist", "README.md", "LICENSE", "schema.json"]);
    for (const file of ["dist/cli.js", "dist/index.js", "dist/index.d.ts", "LICENSE", "schema.json"]) expect(existsSync(file)).toBe(true);
  });
  it("describes what it does for people searching npm and GitHub", () => {
    const manifest = json("package.json");
    expect(manifest.keywords).toEqual(expect.arrayContaining(["claude-code", "codex", "cursor", "github-actions", "pre-commit", "guardrails", "testing"]));
    expect(manifest.description.length).toBeLessThanOrEqual(200);
  });
});
