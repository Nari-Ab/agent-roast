import { describe, expect, it, afterAll } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { auditPullRequest } from "../src/index.js";
import { reviewChanges } from "../src/review.js";
import type { DetectorType } from "../src/types.js";

/** Deliberately small, transparent regression corpus. Not a user study or broad
 * accuracy claim; cases and labels are maintained alongside the implementation. */
const cases: { name: string; file: string; before: string; after: string; introduced: DetectorType[]; removed?: number }[] = [
  { name: "delete only catch handler", file: "save.ts", before: "try { save(); } catch (error) {\n  report(error);\n}\n", after: "try { save(); } catch (error) {\n}\n", introduced: ["swallowed-error"] },
  { name: "add empty catch", file: "save.ts", before: "save();\n", after: "try { save(); } catch {}\n", introduced: ["swallowed-error"] },
  { name: "add skipped test", file: "auth.test.ts", before: "it('auth');\n", after: "it.skip('auth');\n", introduced: ["test-skip"] },
  { name: "add duplicate skip", file: "auth.test.ts", before: "it.skip('auth');\n", after: "it.skip('auth');\nit.skip('auth');\n", introduced: ["test-skip"] },
  { name: "add fake assertion", file: "auth.test.ts", before: "it('auth');\n", after: "it('auth');\nexpect(true).toBe(true);\n", introduced: ["trivial-assert"] },
  { name: "add type escape", file: "auth.ts", before: "const value = parse(data);\n", after: "const value = data as any;\n", introduced: ["type-escape"] },
  { name: "add unfinished stub", file: "save.ts", before: "export function save() { return true; }\n", after: "export function save() { throw new Error('Not implemented'); }\n", introduced: ["stub-abandonment"] },
  { name: "example inside existing comment", file: "auth.ts", before: "/*\nExamples\n*/\nconst ok = true;\n", after: "/*\nExamples\nit.skip('example');\n*/\nconst ok = true;\n", introduced: [] },
  { name: "example inside existing docstring", file: "auth.py", before: '"""\nExamples\n"""\nvalue = 1\n', after: '"""\nExamples\npytest.skip("example")\n"""\nvalue = 1\n', introduced: [] },
  { name: "indent existing shortcut", file: "auth.test.ts", before: "it.skip('auth');\n", after: "  it.skip('auth');\n", introduced: [] },
  { name: "real error handling", file: "save.ts", before: "save();\n", after: "try { save(); } catch (error) {\n  throw error;\n}\n", introduced: [] },
  { name: "fix skipped test", file: "auth.test.ts", before: "it.skip('auth');\n", after: "it('auth');\n", introduced: [], removed: 1 },
  { name: "fix type bypass", file: "auth.ts", before: "const value = data as any;\n", after: "const value = parse(data);\n", introduced: [], removed: 1 },
  { name: "normal behavior assertion", file: "auth.test.ts", before: "it('auth');\n", after: "it('auth');\nexpect(canSignIn(valid)).toBe(true);\n", introduced: [] },
];
const records: Record<string, unknown>[] = [];

describe("labeled before/after regression corpus", () => {
  for (const fixture of cases) it(fixture.name, async () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "roast-eval-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init", "-b", "main"); git("config", "user.name", "Evaluation"); git("config", "user.email", "eval@example.invalid"); git("config", "commit.gpgsign", "false");
      fs.writeFileSync(path.join(dir, fixture.file), fixture.before); git("add", "."); git("commit", "-m", "before"); const base = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(dir, fixture.file), fixture.after); git("add", "."); git("commit", "-m", "after");
      const start = performance.now();
      const legacy = await auditPullRequest({ cwd: dir, base });
      const review = await reviewChanges({ cwd: dir, base });
      const expected = [...fixture.introduced].sort();
      const actual = review.infractions.map(finding => finding.type).sort();
      records.push({ scenario: fixture.name, expectedIntroduced: expected, addedLineFindings: legacy.infractions.map(finding => finding.type).sort(), contextFindings: actual,
        removedFindings: review.removedFindings.length, complete: review.complete, elapsedMs: Math.round(performance.now() - start) });
      expect(review.complete).toBe(true); expect(actual).toEqual(expected);
      if (fixture.removed !== undefined) expect(review.removedFindings).toHaveLength(fixture.removed);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

afterAll(() => {
  if (!process.env.AGENT_ROAST_EVAL_OUTPUT) return;
  const exact = (key: string) => records.filter(row => JSON.stringify(row[key]) === JSON.stringify(row.expectedIntroduced)).length;
  const report = { date: "2026-10-24", corpus: "14 project-maintained labeled synthetic changes", limitations: "Regression controls selected by the project author; not independent accuracy, production effectiveness, customer validation or an economic result.",
    cases: records, exactMatchCases: { addedLines: exact("addedLineFindings"), contextReview: exact("contextFindings"), total: cases.length } };
  fs.writeFileSync(process.env.AGENT_ROAST_EVAL_OUTPUT, JSON.stringify(report, null, 2) + "\n");
});
