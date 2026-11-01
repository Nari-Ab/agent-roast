import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewChanges } from "../src/review.js";
// @ts-expect-error plain ESM data module shared with scripts/benchmark-recall.mjs
import { cases } from "../benchmarks/cases.mjs";

type Case = { name: string; expect: string | null; before: Record<string, string | null>; after: Record<string, string | null> };
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function apply(dir: string, files: Record<string, string | null>): void {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file);
    if (text === null) { fs.rmSync(target, { force: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
  }
}

describe("labeled cheat and control cases", () => {
  for (const testCase of cases as Case[]) {
    it(testCase.name, async () => {
      const dir = fs.mkdtempSync(path.join(tmpdir(), "roast-bench-")); dirs.push(dir);
      const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      git("init", "-q", "-b", "main"); git("config", "user.name", "Bench"); git("config", "user.email", "bench@example.invalid"); git("config", "commit.gpgsign", "false");
      apply(dir, { "README.md": "bench\n", ...testCase.before }); git("add", "-A"); git("commit", "-q", "-m", "before");
      const base = git("rev-parse", "HEAD");
      apply(dir, testCase.after); git("add", "-A"); git("commit", "-q", "-m", "after");
      const result = await reviewChanges({ cwd: dir, base, failOn: [] });
      const found = [...new Set(result.infractions.map(finding => finding.type))];
      expect(result.complete).toBe(true);
      if (testCase.expect === null || testCase.expect === "miss") expect(found).toEqual([]);
      else expect(found).toContain(testCase.expect);
    });
  }
});
