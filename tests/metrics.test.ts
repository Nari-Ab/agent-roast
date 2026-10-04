import { describe, it, expect } from "vitest";
import { MetricsCollector } from "../src/metrics.js";
import { ParsedCommit } from "../src/git.js";

describe("Metrics Engine", () => {
  it("detects skipped tests in added lines", () => {
    const collector = new MetricsCollector({ all: true });

    const commit: ParsedCommit = {
      hash: "c1",
      date: "2026-10-04T12:00:00Z",
      authorName: "Alice",
      authorEmail: "alice@test.com",
      message: "wip test",
      isAiAttributed: true,
      aiSignatures: ["trailer:claude"],
      totalAddedCount: 300,
      files: [
        {
          path: "tests/user.test.ts",
          addedLines: [
            { line: "it.skip('should handle timeout', () => {});", lineNumber: 15 },
            { line: "describe.skip('legacy tests', () => {});", lineNumber: 25 },
          ],
        },
      ],
    };

    collector.processCommit(commit);
    const summary = collector.getSummary();

    expect(summary.testSkips).toHaveLength(2);
    expect(summary.testSkips[0].reason).toContain("it.skip");
    expect(summary.testSkips[1].reason).toContain("describe.skip");
  });

  it("detects type escapes: as any, @ts-ignore, @ts-expect-error without comment", () => {
    const collector = new MetricsCollector({ all: true });

    const commit: ParsedCommit = {
      hash: "c2",
      date: "2026-10-04T12:00:00Z",
      authorName: "Claude",
      authorEmail: "claude@test.com",
      message: "feat: types",
      isAiAttributed: true,
      aiSignatures: ["author:claude"],
      totalAddedCount: 400,
      files: [
        {
          path: "src/utils.ts",
          addedLines: [
            { line: "const payload = data as any;", lineNumber: 5 },
            { line: "// @ts-ignore", lineNumber: 10 },
            { line: "// eslint-disable-next-line @typescript-eslint/no-explicit-any", lineNumber: 20 },
          ],
        },
      ],
    };

    collector.processCommit(commit);
    const summary = collector.getSummary();

    expect(summary.typeEscapes).toHaveLength(3);
  });

  it("detects swallowed errors: empty catch blocks", () => {
    const collector = new MetricsCollector({ all: true });

    const commit: ParsedCommit = {
      hash: "c3",
      date: "2026-10-04T12:00:00Z",
      authorName: "Dev",
      authorEmail: "dev@test.com",
      message: "fix: silent error",
      isAiAttributed: true,
      aiSignatures: ["trailer:cursor"],
      totalAddedCount: 300,
      files: [
        {
          path: "src/api.ts",
          addedLines: [
            { line: "try { doSomething(); } catch (e) {}", lineNumber: 12 },
            { line: "try { fetch(); } catch {}", lineNumber: 18 },
            { line: "except: pass", lineNumber: 24 },
          ],
        },
      ],
    };

    collector.processCommit(commit);
    const summary = collector.getSummary();

    expect(summary.swallowedErrors).toHaveLength(3);
  });

  it("detects panic loops: consecutive fix/revert commits within 15 minutes", () => {
    const collector = new MetricsCollector({ all: true });

    const c1: ParsedCommit = {
      hash: "p1",
      date: "2026-10-04T14:00:00Z",
      authorName: "Agent",
      authorEmail: "agent@bot",
      message: "fix: try fixing payment error",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 150,
      files: [],
    };

    const c2: ParsedCommit = {
      hash: "p2",
      date: "2026-10-04T14:04:00Z", // 4 mins later
      authorName: "Agent",
      authorEmail: "agent@bot",
      message: "fix again: still failing payment",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 150,
      files: [],
    };

    collector.processCommit(c1);
    collector.processCommit(c2);

    const summary = collector.getSummary();
    expect(summary.panicLoops).toHaveLength(1);
    expect(summary.panicLoops[0].reason).toContain("Panic loop");
  });

  it("marks isSufficientData=false when total lines added < 200", () => {
    const collector = new MetricsCollector({ all: true });

    const tinyCommit: ParsedCommit = {
      hash: "tiny",
      date: "2026-10-04T10:00:00Z",
      authorName: "Agent",
      authorEmail: "agent@bot",
      message: "fix typo",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 12,
      files: [],
    };

    collector.processCommit(tinyCommit);
    const summary = collector.getSummary();

    expect(summary.isSufficientData).toBe(false);
  });
});
