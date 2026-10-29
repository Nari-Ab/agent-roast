import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

let dir: string;
let repo: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-action-"));
  repo = path.join(dir, "candidate repo"); fs.mkdirSync(repo); repo = fs.realpathSync(repo);
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin);
  const runner = path.join(dir, "runner"); fs.mkdirSync(runner);
  fs.writeFileSync(path.join(repo, ".npmrc"), "registry=https://invalid.example.invalid/\n");
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh
set -eu
[ "$PWD" != "$TEST_REPO" ] || exit 99
printf '%s\\n' "$PWD" > "$INSTALL_CWD"
printf '%s\\n' "$@" > "$INSTALL_ARGS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then shift; prefix="$1"; fi
  shift
done
mkdir -p "$prefix/node_modules/.bin"
cat > "$prefix/node_modules/.bin/agent-roast" <<'CLI'
#!/bin/sh
printf '%s\\n' "$@" > "$COMMAND_ARGS_FILE"
CLI
chmod +x "$prefix/node_modules/.bin/agent-roast"
`, { mode: 0o755 });
  const action = fs.readFileSync("action.yml", "utf8");
  const body = action.split("      run: |\n")[1];
  fs.writeFileSync(path.join(dir, "action.sh"), body.split("\n").map(line => line.startsWith("        ") ? line.slice(8) : line).join("\n"));
  env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, TEST_REPO: repo,
    INSTALL_CWD: path.join(dir, "install-cwd"), INSTALL_ARGS: path.join(dir, "install-args"), COMMAND_ARGS_FILE: path.join(dir, "args"), RUNNER_TEMP: runner,
    GITHUB_EVENT_NAME: "pull_request", INPUT_BASE: "abc123", INPUT_HEAD: "def456", ROAST_MODE: "review", ROAST_FORMAT: "github", ROAST_FAIL_ON: "",
  };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const run = (overrides: NodeJS.ProcessEnv = {}) => spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", path.join(dir, "action.sh")], { cwd: repo, env: { ...env, ...overrides }, encoding: "utf8" });
const args = () => fs.readFileSync(path.join(dir, "args"), "utf8").trim().split("\n");

describe("composite action context-review integration", () => {
  it("installs away from candidate npm config, runs review, and cleans the install directory", () => {
    expect(run().status).toBe(0);
    expect(args()).toEqual(["review", repo, "--base", "abc123", "--head", "def456", "--format", "github"]);
    expect(fs.readFileSync(path.join(dir, "install-args"), "utf8")).toContain("agent-roast@0.8.1");
    expect(fs.readFileSync(path.join(dir, "install-cwd"), "utf8").trim()).not.toBe(repo);
    expect(fs.readdirSync(path.join(dir, "runner"))).toEqual([]);
    expect(fs.existsSync(path.join(repo, ".npmrc"))).toBe(true);
  });
  it("keeps an explicit legacy audit mode and passes fail-on as one argument", () => {
    expect(run({ ROAST_MODE: "audit", ROAST_FAIL_ON: "test-skip,swallowed-error" }).status).toBe(0);
    expect(args()).toEqual([repo, "--base", "abc123", "--head", "def456", "--fail-on", "test-skip,swallowed-error", "--format", "github"]);
  });
  it("supports explicit advisory pilots without treating incomplete scans as clean", () => {
    expect(run({ ROAST_ADVISORY: "true", ROAST_FAIL_ON: "test-skip" }).status).toBe(0);
    expect(args()).toEqual(["review", repo, "--base", "abc123", "--head", "def456", "--fail-on", "", "--format", "github"]);
    expect(run({ ROAST_ADVISORY: "maybe" }).status).toBe(2);
  });
  it("does not interpolate branch text as shell commands", () => {
    expect(run({ INPUT_BASE: "HEAD; touch OWNED" }).status).toBe(0);
    expect(args()).toContain("HEAD; touch OWNED"); expect(fs.existsSync(path.join(repo, "OWNED"))).toBe(false);
  });
  it.each([{ ROAST_MODE: "unknown" }, { GITHUB_EVENT_NAME: "pull_request_target" }, { INPUT_BASE: "", PR_BASE_SHA: "", EVENT_BEFORE_SHA: "" }])("rejects unsafe or unresolved requests before installation %j", overrides => {
    expect(run(overrides).status).toBe(2); expect(fs.existsSync(path.join(dir, "install-cwd"))).toBe(false);
  });
});
