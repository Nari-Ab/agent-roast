import * as fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import pc from "picocolors";
import { ConfigError } from "./config.js";
import { getHermeticGitEnv, HERMETIC_GIT_FLAGS } from "./git.js";
import { formatReviewTerminal } from "./renderer.js";
import { reviewWorktreeChanges } from "./review.js";
import type { ReviewResult } from "./types.js";

export interface DemoResult {
  exitCode: number;
  output: string;
  result: ReviewResult;
}

const CART = `export function total(prices: number[], discount = 0): number {
  const sum = prices.reduce((a, b) => a + b, 0);
  return sum - sum * discount;
}
`;

const CART_TEST = (weakened: boolean) => `import { total } from "./cart";

describe("cart total", () => {
  it("sums the prices", () => {
    expect(total([10, 20, 12])).${weakened ? "toBeDefined()" : "toBe(42)"};
  });

  ${weakened ? "it.skip" : "it"}("applies a discount", () => {
    expect(total([50, 50], 0.1)).toBe(90);
  });

  it("is zero for an empty cart", () => {
    ${weakened ? "expect(true).toBe(true)" : "expect(total([])).toBe(0)"};
  });
});
`;

const VITEST_CONFIG = (lines: number, branches: number) => `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { coverage: { thresholds: { lines: ${lines}, branches: ${branches} } } },
});
`;

const CI = (lenient: boolean) => `name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Run tests
${lenient ? "        continue-on-error: true\n" : ""}        run: npm test
`;

/**
 * A scripted example in a throwaway repository: a project with passing tests, then the kind of "fix" that turns a red build
 * green by changing the checks. The review is the real one; nothing of the user's is read, and the repository is deleted.
 */
export async function runDemo(options: { signal?: AbortSignal } = {}): Promise<DemoResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-roast-demo-"));
  try {
    const git = (...args: string[]) => {
      const run = spawnSync("git", [...HERMETIC_GIT_FLAGS, "-c", "user.name=agent-roast demo", "-c", "user.email=demo@example.invalid",
        "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${path.join(dir, ".no-hooks")}`, ...args],
      { cwd: dir, env: getHermeticGitEnv(), encoding: "utf8", timeout: 30_000, windowsHide: true });
      if (run.error || run.status !== 0) throw new ConfigError(`The demo needs Git to create a temporary repository: ${run.error?.message ?? run.stderr.trim()}`);
    };
    const write = (file: string, text: string) => {
      const destination = path.join(dir, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, text);
    };
    git("init", "-q", "-b", "main");
    write("src/cart.ts", CART);
    write("src/cart.test.ts", CART_TEST(false));
    write("vitest.config.ts", VITEST_CONFIG(90, 85));
    write(".github/workflows/ci.yml", CI(false));
    git("add", "-A");
    git("commit", "-q", "-m", "Add cart total");

    // The agent was asked to get a failing build green. Fixing total() is hard, so it changes the checks.
    write("src/cart.test.ts", CART_TEST(true));
    write("vitest.config.ts", VITEST_CONFIG(50, 40));
    write(".github/workflows/ci.yml", CI(true));

    const result = await reviewWorktreeChanges({ cwd: dir, signal: options.signal });
    const output = [
      "",
      pc.bold("agent-roast demo") + pc.dim(" — a scripted example in a temporary repository; nothing of yours is read or changed"),
      "",
      "A build was red. The \"fix\" below turns it green without touching the code under test:",
      "",
      `  ${pc.cyan("src/cart.test.ts")}              toBe(42) → toBeDefined()   ·   it.skip(\"applies a discount\")   ·   expect(true).toBe(true)`,
      `  ${pc.cyan("vitest.config.ts")}              coverage thresholds lowered: lines 90 → 50, branches 85 → 40`,
      `  ${pc.cyan(".github/workflows/ci.yml")}      continue-on-error: true on the test step`,
      "",
      "What agent-roast reports for that working tree:",
      formatReviewTerminal(result).replace(/\s+$/, ""),
      "",
      pc.bold("Use it on your own work"),
      `  ${pc.cyan("npx agent-roast")}                    review what you have not committed yet`,
      `  ${pc.cyan("npx agent-roast replay")}             replay your last 50 commits, one at a time`,
      `  ${pc.cyan("npx agent-roast hook install")}       send your coding agent back to fix the code when it weakens a check`,
      "",
    ].join("\n");
    return { exitCode: result.failedRules.length ? 0 : 1, output, result };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
