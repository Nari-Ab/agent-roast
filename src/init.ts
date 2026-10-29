import * as fs from "fs";
import * as path from "path";
import { DEFAULT_CONFIG, ConfigError } from "./config.js";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import { getHermeticGitEnv, HERMETIC_GIT_FLAGS, gitOutputPath } from "./git.js";

export interface InitOptions {
  cwd?: string;
  yes?: boolean;
  ci?: boolean;
  hook?: boolean;
}

export interface InitResult {
  /** Actual project root containing the initialized files. */
  directory: string;
  created: string[];
  skipped: string[];
}

export const DEFAULT_CONFIG_TEMPLATE = {
  ignorePaths: [
    "**/*.min.js",
    "**/vendor/**",
    "**/dist/**",
    "**/build/**",
    "**/fixtures/**",
  ],
  rules: { ...DEFAULT_CONFIG.rules },
  scoreThreshold: 70,
};

export const GITHUB_WORKFLOW_TEMPLATE = `name: Agent Roast
on:
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  audit:
    name: Audit AI Shortcuts
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run agent-roast PR check
        if: github.event_name == 'pull_request'
        uses: Nari-Ab/agent-roast@v1
        with:
          base: \${{ github.event.pull_request.base.sha }}
          head: \${{ github.event.pull_request.head.sha }}
          format: github
          mode: review
`;

export const PRE_COMMIT_HOOK_TEMPLATE = `#!/bin/sh
# Run agent-roast pre-commit verification
npx --no-install agent-roast --staged
`;

/** Reject symlinked ancestors and publish complete files without replacing any
 * existing directory entry (including dangling links and concurrent writers). */
function createNewFile(root: string, relative: string, content: string, mode = 0o644): boolean {
  const destination = path.resolve(root, relative);
  const inside = path.relative(root, destination);
  if (!inside || inside === ".." || inside.startsWith(".." + path.sep) || path.isAbsolute(inside)) throw new ConfigError("Initialization target escapes its allowed directory.");
  let directory = root;
  for (const segment of path.dirname(inside).split(path.sep).filter(part => part !== ".")) {
    directory = path.join(directory, segment);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { fs.mkdirSync(directory); }
      catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError; }
      stat = fs.lstatSync(directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ConfigError("Initialization refuses symlinked or non-directory parent paths.");
  }
  const temporary = path.join(directory, `.agent-roast-init-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    try { fs.linkSync(temporary, destination); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    return true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}

const hasEntry = (filename: string): boolean => {
  try { fs.lstatSync(filename); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
};

export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  let cwd = fs.realpathSync(path.resolve(options.cwd || process.cwd()));
  // check/review load policy from the repository root, and GitHub only reads
  // workflows there. Starting init in a package must configure that same root.
  const root = spawnSync("git", [...HERMETIC_GIT_FLAGS, "rev-parse", "--show-toplevel"], {
    cwd, env: { ...getHermeticGitEnv(), LC_ALL: "C" }, encoding: "utf8", timeout: 30_000, maxBuffer: 8192, windowsHide: true,
  });
  if (root.error) throw new ConfigError("Cannot resolve the repository root for initialization.");
  if (root.status === 0) cwd = fs.realpathSync(gitOutputPath(root.stdout));
  else if (root.status !== 128 || !root.stderr.includes("not a git repository")) {
    throw new ConfigError("Cannot resolve a working repository root for initialization.");
  }
  const created: string[] = [];
  const skipped: string[] = [];
  const publish = (root: string, relative: string, label: string, content: string, mode?: number) => {
    (createNewFile(root, relative, content, mode) ? created : skipped).push(label);
  };
  if ([".agentroastrc.json", "agent-roast.config.json", ".agentroastrc"].some(name => hasEntry(path.join(cwd, name)))) {
    skipped.push(".agentroastrc.json");
  } else publish(cwd, ".agentroastrc.json", ".agentroastrc.json", JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + "\n");

  if (options.ci) publish(cwd, ".github/workflows/agent-roast.yml", ".github/workflows/agent-roast.yml", GITHUB_WORKFLOW_TEMPLATE);

  if (options.hook) {
    // rev-parse supports ordinary clones, subdirectories and linked worktrees.
    // Never run a configured hook or overwrite an existing installation.
    const run = (...args: string[]) => spawnSync("git", [...HERMETIC_GIT_FLAGS, ...args], {
      cwd, env: getHermeticGitEnv(), encoding: "utf8", timeout: 30_000, maxBuffer: 8192, windowsHide: true,
    });
    const common = run("rev-parse", "--git-common-dir");
    if (common.error || common.status !== 0) {
      // Preserve compatibility with initializing an empty .git directory before
      // git init; there is no repository metadata to follow outside this root.
      const plainGit = path.join(cwd, ".git");
      if (hasEntry(plainGit) && fs.lstatSync(plainGit).isDirectory() && !fs.lstatSync(plainGit).isSymbolicLink()) {
        publish(plainGit, "hooks/pre-commit", ".git/hooks/pre-commit", PRE_COMMIT_HOOK_TEMPLATE, 0o755);
      } else skipped.push(".git/hooks/pre-commit (no .git directory found)");
    } else {
      const commonDir = fs.realpathSync(path.resolve(cwd, gitOutputPath(common.stdout)));
      const hooks = run("rev-parse", "--git-path", "hooks");
      if (hooks.error || hooks.status !== 0) throw new ConfigError("Cannot resolve this repository's hooks directory.");
      const hookDir = path.resolve(cwd, gitOutputPath(hooks.stdout));
      const relative = path.relative(commonDir, path.join(hookDir, "pre-commit"));
      if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        skipped.push(".git/hooks/pre-commit (custom hooks path outside repository metadata; install manually)");
      } else publish(commonDir, relative, ".git/hooks/pre-commit", PRE_COMMIT_HOOK_TEMPLATE, 0o755);
    }
  }
  return { directory: cwd, created, skipped };
}
