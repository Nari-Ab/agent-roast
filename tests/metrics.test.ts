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
      files: [{ path: "src/payment.ts", addedLines: [] }],
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
      files: [{ path: "src/payment.ts", addedLines: [] }],
    };

    collector.processCommit(c1);
    collector.processCommit(c2);

    const summary = collector.getSummary();
    expect(summary.panicLoops).toHaveLength(1);
    expect(summary.panicLoops[0].reason).toContain("chain of 2 quick fixes");
  });

  it("coalesces 5 consecutive quick fixes into a single panic loop chain", () => {
    const collector = new MetricsCollector({ all: true });

    for (let i = 1; i <= 5; i++) {
      collector.processCommit({
        hash: `fix${i}`,
        date: new Date(1760000000000 + i * 2 * 60 * 1000).toISOString(),
        authorName: "Agent",
        authorEmail: "agent@bot",
        message: `fix: attempt ${i}`,
        isAiAttributed: true,
        aiSignatures: ["author:bot"],
        totalAddedCount: 50,
        files: [{ path: "src/payment.ts", addedLines: [] }],
      });
    }

    const summary = collector.getSummary();
    expect(summary.panicLoops).toHaveLength(1);
    expect(summary.panicLoops[0].reason).toContain("chain of 5 quick fixes");
  });

  it("does not count panic loop when consecutive fixes touch disjoint files", () => {
    const collector = new MetricsCollector({ all: true });

    collector.processCommit({
      hash: "f1",
      date: "2026-10-04T14:00:00Z",
      authorName: "Agent",
      authorEmail: "agent@bot",
      message: "fix: auth module",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 10,
      files: [{ path: "src/auth.ts", addedLines: [] }],
    });

    collector.processCommit({
      hash: "f2",
      date: "2026-10-04T14:03:00Z",
      authorName: "Agent",
      authorEmail: "agent@bot",
      message: "fix: billing module",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 10,
      files: [{ path: "src/billing.ts", addedLines: [] }],
    });

    const summary = collector.getSummary();
    expect(summary.panicLoops).toHaveLength(0);
  });

  it("does not count panic loops across different authors or zero-diff rebase timestamps", () => {
    const collector = new MetricsCollector({ all: true });

    // Different authors
    collector.processCommit({
      hash: "d1",
      date: "2026-10-04T14:00:00Z",
      authorName: "Alice",
      authorEmail: "alice@test.com",
      message: "fix: bug A",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 150,
      files: [],
    });
    collector.processCommit({
      hash: "d2",
      date: "2026-10-04T14:02:00Z",
      authorName: "Bob",
      authorEmail: "bob@test.com",
      message: "fix: bug B",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 150,
      files: [],
    });

    // Zero-diff timestamp (rebase script)
    collector.processCommit({
      hash: "d3",
      date: "2026-10-04T15:00:00Z",
      authorName: "Bob",
      authorEmail: "bob@test.com",
      message: "fix: step 1",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 150,
      files: [],
    });
    collector.processCommit({
      hash: "d4",
      date: "2026-10-04T15:00:00Z",
      authorName: "Bob",
      authorEmail: "bob@test.com",
      message: "fix: step 2",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 150,
      files: [],
    });

    const summary = collector.getSummary();
    expect(summary.panicLoops).toHaveLength(0);
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

  it("ignores patterns inside string literals and regex definitions (prevents self-flagging)", () => {
    const collector = new MetricsCollector({ all: true });

    const commit: ParsedCommit = {
      hash: "self-test",
      date: "2026-10-04T12:00:00Z",
      authorName: "Dev",
      authorEmail: "dev@test.com",
      message: "test: add assertions",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 500,
      files: [
        {
          path: "tests/fixtures_detector.test.ts",
          addedLines: [
            { line: 'const mock = "{ line: \\"it.skip(\\\'foo\\\')\\" }";', lineNumber: 10 },
            { line: 'expect(output).toBe("as any");', lineNumber: 11 },
            { line: 'const regex = /(?:it|test|describe)\\.skip\\b/;', lineNumber: 12 },
            { line: '// Real comment explaining why as any is bad', lineNumber: 13 },
          ],
        },
      ],
    };

    collector.processCommit(commit);
    const summary = collector.getSummary();

    expect(summary.testSkips).toHaveLength(0);
    expect(summary.typeEscapes).toHaveLength(0);
    expect(summary.swallowedErrors).toHaveLength(0);
  });

  it("ignores files in fixture and mock directories", () => {
    const collector = new MetricsCollector({ all: true });

    const commit: ParsedCommit = {
      hash: "fixture-commit",
      date: "2026-10-04T12:00:00Z",
      authorName: "Dev",
      authorEmail: "dev@test.com",
      message: "test: add fixture data",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 400,
      files: [
        {
          path: "tests/fixtures/broken_sample.ts",
          addedLines: [
            { line: "it.skip('fixture test', () => {});", lineNumber: 1 },
            { line: "const x = 1 as any;", lineNumber: 2 },
          ],
        },
      ],
    };

    collector.processCommit(commit);
    const summary = collector.getSummary();

    expect(summary.testSkips).toHaveLength(0);
    expect(summary.typeEscapes).toHaveLength(0);
  });

  it("assigns Pragmatic Builder or Clean Coder when score >= 90 instead of harsh roast", () => {
    const collector = new MetricsCollector({ all: true });

    const commit: ParsedCommit = {
      hash: "clean-commit",
      date: "2026-10-04T12:00:00Z",
      authorName: "Dev",
      authorEmail: "dev@test.com",
      message: "feat: big clean feature",
      isAiAttributed: true,
      aiSignatures: ["author:bot"],
      totalAddedCount: 50000,
      files: [
        {
          path: "src/service.ts",
          addedLines: [
            { line: "const payload = raw as any;", lineNumber: 100 },
          ],
        },
      ],
    };

    collector.processCommit(commit);
    const summary = collector.getSummary();

    expect(summary.score).toBeGreaterThanOrEqual(90);
    expect(summary.archetype).toBe("The Pragmatic Builder");
    expect(summary.archetype).not.toBe("The Silent Vandal");
  });
});
