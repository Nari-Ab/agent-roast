import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
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
printf '%s\\n' "$*" >> "$COMMAND_LOG"
case " $* " in *" --format markdown "*) [ -z "\${STUB_MARKDOWN:-}" ] || cat "$STUB_MARKDOWN"; exit 0 ;; esac
exit "\${STUB_EXIT:-0}"
CLI
chmod +x "$prefix/node_modules/.bin/agent-roast"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_LOG"
case "$*" in
  *"--method"*) ;;
  *) [ -z "\${GH_EXISTING_ID:-}" ] || printf '%s\\n' "$GH_EXISTING_ID" ;;
esac
exit "\${GH_EXIT:-0}"
`, { mode: 0o755 });
  const action = fs.readFileSync("action.yml", "utf8");
  const body = action.split("      run: |\n")[1];
  fs.writeFileSync(path.join(dir, "action.sh"), body.split("\n").map(line => line.startsWith("        ") ? line.slice(8) : line).join("\n"));
  env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, TEST_REPO: repo,
    INSTALL_CWD: path.join(dir, "install-cwd"), INSTALL_ARGS: path.join(dir, "install-args"), COMMAND_ARGS_FILE: path.join(dir, "args"), COMMAND_LOG: path.join(dir, "commands"), GH_LOG: path.join(dir, "gh"), RUNNER_TEMP: runner,
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
    expect(fs.readFileSync(path.join(dir, "install-args"), "utf8")).toContain(`agent-roast@${version}`);
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

describe("pull request comment", () => {
  const commands = () => fs.readFileSync(path.join(dir, "commands"), "utf8").trim().split("\n");
  const ghCalls = () => fs.existsSync(path.join(dir, "gh")) ? fs.readFileSync(path.join(dir, "gh"), "utf8").trim().split("\n") : [];
  const markdown = (text: string) => { const file = path.join(dir, "report.md"); fs.writeFileSync(file, text); return { STUB_MARKDOWN: file }; };
  const FINDINGS = "## agent-roast context review: BLOCKED\n\n**1 new** · 0 existing · 0 no longer detected.\n";
  const CLEAN = "## agent-roast context review: PASSED\n\n**0 new** · 0 existing · 0 no longer detected.\n";
  const comment = { ROAST_COMMENT: "true", PR_NUMBER: "7", GITHUB_REPOSITORY: "acme/app", GITHUB_ACTION_PATH: path.resolve(".") };

  it("does nothing unless asked", () => {
    expect(run({ ...comment, ROAST_COMMENT: "false", ...markdown(FINDINGS) }).status).toBe(0);
    expect(commands()).toHaveLength(1);
    expect(ghCalls()).toEqual([]);
  });
  it("posts one comment with the findings, from a second advisory run, and keeps the check's own result", () => {
    const result = run({ ...comment, ...markdown(FINDINGS), STUB_EXIT: "1" });
    expect(result.status).toBe(1);
    expect(commands()).toEqual([
      `review ${repo} --base abc123 --head def456 --format github`,
      `review ${repo} --base abc123 --head def456 --advisory --format markdown`,
    ]);
    expect(ghCalls()).toHaveLength(2);
    expect(ghCalls()[0]).toContain("repos/acme/app/issues/7/comments --paginate");
    expect(ghCalls()[1]).toMatch(/^api --method POST repos\/acme\/app\/issues\/7\/comments -F body=@/);
  });
  it("updates its earlier comment instead of adding another", () => {
    expect(run({ ...comment, ...markdown(FINDINGS), GH_EXISTING_ID: "991" }).status).toBe(0);
    expect(ghCalls()[1]).toMatch(/^api --method PATCH repos\/acme\/app\/issues\/comments\/991 -F body=@/);
  });
  it("stays quiet on a clean pull request, but corrects an earlier comment", () => {
    expect(run({ ...comment, ...markdown(CLEAN) }).status).toBe(0);
    expect(ghCalls()).toHaveLength(1);
    fs.rmSync(path.join(dir, "gh"));
    expect(run({ ...comment, ...markdown(CLEAN), GH_EXISTING_ID: "991" }).status).toBe(0);
    expect(ghCalls()[1]).toContain("--method PATCH");
  });
  it("writes the marker and the offline footer into the comment", () => {
    const capture = path.join(dir, "bin", "gh");
    fs.writeFileSync(capture, `#!/bin/sh\ncase "$*" in *"--method"*) for arg in "$@"; do case "$arg" in body=@*) cp "\${arg#body=@}" "$GH_BODY" ;; esac; done ;; esac\nexit 0\n`, { mode: 0o755 });
    expect(run({ ...comment, ...markdown(FINDINGS), GH_BODY: path.join(dir, "body.md") }).status).toBe(0);
    const body = fs.readFileSync(path.join(dir, "body.md"), "utf8");
    expect(body.startsWith("<!-- agent-roast:comment -->\n## agent-roast context review: BLOCKED")).toBe(true);
    expect(body).toContain("the code did not leave this runner");
  });
  it("does not fail the job when the token cannot comment, and says so", () => {
    const result = run({ ...comment, ...markdown(FINDINGS), GH_EXIT: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::notice::agent-roast: could not post a comment");
  });
  it("skips the comment outside pull requests and in the legacy audit mode, and rejects an unclear value", () => {
    expect(run({ ...comment, PR_NUMBER: "", ...markdown(FINDINGS) }).status).toBe(0);
    expect(run({ ...comment, ROAST_MODE: "audit", ...markdown(FINDINGS) }).status).toBe(0);
    expect(ghCalls()).toEqual([]);
    expect(run({ ...comment, ROAST_COMMENT: "yes" }).status).toBe(2);
  });
});
