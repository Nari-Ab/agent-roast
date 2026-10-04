import { describe, it, expect } from "vitest";
import { parseGitLogStream } from "../src/git.js";
import { Readable } from "stream";

describe("Streaming Git Log Parser", () => {
  it("parses multiple commits with headers, trailers, and added diff lines", async () => {
    // \x1e is commit separator, \x1f is field separator
    const raw =
      "\x1e" +
      "c1001\x1f" +
      "2026-10-04T12:00:00Z\x1f" +
      "Alice Developer\x1f" +
      "alice@example.com\x1f" +
      "feat: add billing module\n\nCo-Authored-By: Claude <noreply@anthropic.com>\x1f" +
      "diff --git a/src/billing.ts b/src/billing.ts\n" +
      "--- a/src/billing.ts\n" +
      "+++ b/src/billing.ts\n" +
      "@@ -10,0 +11,2 @@\n" +
      "+const x = 1 as any;\n" +
      "+// @ts-ignore\n" +
      "\x1e" +
      "c1002\x1f" +
      "2026-10-04T12:05:00Z\x1f" +
      "Bob Lead\x1f" +
      "bob@example.com\x1f" +
      "chore: update readme\x1f" +
      "diff --git a/README.md b/README.md\n" +
      "@@ -1,1 +1,2 @@\n" +
      "+# My Cool Project\n";

    const stream = Readable.from([raw]);
    const parsedCommits: any[] = [];

    await parseGitLogStream(stream, (commit) => {
      parsedCommits.push(commit);
    });

    expect(parsedCommits).toHaveLength(2);

    const c1 = parsedCommits[0];
    expect(c1.hash).toBe("c1001");
    expect(c1.isAiAttributed).toBe(true);
    expect(c1.files).toHaveLength(1);
    expect(c1.files[0].path).toBe("src/billing.ts");
    expect(c1.files[0].addedLines).toEqual([
      { line: "const x = 1 as any;", lineNumber: 11 },
      { line: "// @ts-ignore", lineNumber: 12 },
    ]);

    const c2 = parsedCommits[1];
    expect(c2.hash).toBe("c1002");
    expect(c2.isAiAttributed).toBe(false);
    expect(c2.files[0].path).toBe("README.md");
  });
});
