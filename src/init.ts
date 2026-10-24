import * as fs from "fs";
import * as path from "path";
import { DEFAULT_CONFIG } from "./config.js";

export interface InitOptions {
  cwd?: string;
  yes?: boolean;
  ci?: boolean;
  hook?: boolean;
}

export interface InitResult {
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

export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const created: string[] = [];
  const skipped: string[] = [];

  // 1. Create .agentroastrc.json
  const configPath = path.join(cwd, ".agentroastrc.json");
  const altConfigPath = path.join(cwd, "agent-roast.config.json");

  if (fs.existsSync(configPath) || fs.existsSync(altConfigPath) || fs.existsSync(path.join(cwd, ".agentroastrc"))) {
    skipped.push(".agentroastrc.json");
  } else {
    fs.writeFileSync(
      configPath,
      JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + "\n",
      "utf-8"
    );
    created.push(".agentroastrc.json");
  }

  // 2. Optional CI Workflow
  if (options.ci) {
    const workflowDir = path.join(cwd, ".github", "workflows");
    const workflowPath = path.join(workflowDir, "agent-roast.yml");

    if (fs.existsSync(workflowPath)) {
      skipped.push(".github/workflows/agent-roast.yml");
    } else {
      fs.mkdirSync(workflowDir, { recursive: true });
      fs.writeFileSync(workflowPath, GITHUB_WORKFLOW_TEMPLATE, "utf-8");
      created.push(".github/workflows/agent-roast.yml");
    }
  }

  // 3. Optional Git pre-commit hook
  if (options.hook) {
    const gitDir = path.join(cwd, ".git");
    if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
      skipped.push(".git/hooks/pre-commit (no .git directory found)");
    } else {
      const hooksDir = path.join(gitDir, "hooks");
      const hookPath = path.join(hooksDir, "pre-commit");

      if (fs.existsSync(hookPath)) {
        skipped.push(".git/hooks/pre-commit");
      } else {
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(hookPath, PRE_COMMIT_HOOK_TEMPLATE, {
          encoding: "utf-8",
          mode: 0o755,
        });
        created.push(".git/hooks/pre-commit");
      }
    }
  }

  return { created, skipped };
}
