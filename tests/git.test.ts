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

  it("correctly parses paths containing 'b/' such as lib/ or web/", async () => {
    const raw =
      "\x1e" +
      "c2001\x1f" +
      "2026-10-04T12:00:00Z\x1f" +
      "Dev\x1f" +
      "dev@example.com\x1f" +
      "fix: update lib auth\x1f" +
      "diff --git a/lib/auth.ts b/lib/auth.ts\n" +
      "--- a/lib/auth.ts\n" +
      "+++ b/lib/auth.ts\n" +
      "@@ -5,1 +5,2 @@\n" +
      " const old = 1;\n" +
      "+const added = 2;\n";

    const parsedCommits: any[] = [];
    await parseGitLogStream(Readable.from([raw]), (c) => parsedCommits.push(c));

    expect(parsedCommits).toHaveLength(1);
    expect(parsedCommits[0].files[0].path).toBe("lib/auth.ts");
    expect(parsedCommits[0].files[0].addedLines).toEqual([
      { line: "const added = 2;", lineNumber: 6 },
    ]);
  });

  it("handles '\\ No newline at end of file' without shifting subsequent line numbers", async () => {
    const raw =
      "\x1e" +
      "c2002\x1f" +
      "2026-10-04T12:00:00Z\x1f" +
      "Dev\x1f" +
      "dev@example.com\x1f" +
      "fix: trailing newline\x1f" +
      "diff --git a/src/index.ts b/src/index.ts\n" +
      "--- a/src/index.ts\n" +
      "+++ b/src/index.ts\n" +
      "@@ -10,1 +10,2 @@\n" +
      "-const a = 1;\n" +
      "\\ No newline at end of file\n" +
      "+const a = 1;\n" +
      "+const b = 2;\n";

    const parsedCommits: any[] = [];
    await parseGitLogStream(Readable.from([raw]), (c) => parsedCommits.push(c));

    expect(parsedCommits).toHaveLength(1);
    expect(parsedCommits[0].files[0].addedLines).toEqual([
      { line: "const a = 1;", lineNumber: 10 },
      { line: "const b = 2;", lineNumber: 11 },
    ]);
  });

  it("handles added lines starting with '++' such as '++i;' without confusing with +++ header", async () => {
    const raw =
      "\x1e" +
      "c2003\x1f" +
      "2026-10-04T12:00:00Z\x1f" +
      "Dev\x1f" +
      "dev@example.com\x1f" +
      "feat: counter increment\x1f" +
      "diff --git a/src/counter.ts b/src/counter.ts\n" +
      "--- a/src/counter.ts\n" +
      "+++ b/src/counter.ts\n" +
      "@@ -20,1 +20,2 @@\n" +
      " count = 0;\n" +
      "+++count;\n"; // added line is '++count;'

    const parsedCommits: any[] = [];
    await parseGitLogStream(Readable.from([raw]), (c) => parsedCommits.push(c));

    expect(parsedCommits).toHaveLength(1);
    expect(parsedCommits[0].files[0].path).toBe("src/counter.ts");
    expect(parsedCommits[0].files[0].addedLines).toEqual([
      { line: "++count;", lineNumber: 21 },
    ]);
  });

  it("handles deleted files pointing to /dev/null followed by another file", async () => {
    const raw =
      "\x1e" +
      "c2004\x1f" +
      "2026-10-04T12:00:00Z\x1f" +
      "Dev\x1f" +
      "dev@example.com\x1f" +
      "chore: remove legacy script and add new one\x1f" +
      "diff --git a/scripts/old.sh b/scripts/old.sh\n" +
      "deleted file mode 100644\n" +
      "--- a/scripts/old.sh\n" +
      "+++ /dev/null\n" +
      "@@ -1,2 +0,0 @@\n" +
      "-#!/bin/bash\n" +
      "-echo old\n" +
      "diff --git a/scripts/new.sh b/scripts/new.sh\n" +
      "new file mode 100644\n" +
      "--- /dev/null\n" +
      "+++ b/scripts/new.sh\n" +
      "@@ -0,0 +1,1 @@\n" +
      "+echo new\n";

    const parsedCommits: any[] = [];
    await parseGitLogStream(Readable.from([raw]), (c) => parsedCommits.push(c));

    expect(parsedCommits).toHaveLength(1);
    expect(parsedCommits[0].files).toHaveLength(2);
    expect(parsedCommits[0].files[0].path).toBe("dev/null");
    expect(parsedCommits[0].files[1].path).toBe("scripts/new.sh");
    expect(parsedCommits[0].files[1].addedLines).toEqual([
      { line: "echo new", lineNumber: 1 },
    ]);
  });

  describe("Chunk Boundary Robustness", () => {
    const multiByteRaw =
      "\x1e" +
      "sha_unicode\x1f" +
      "2026-10-04T12:00:00Z\x1f" +
      "Нариман Разработчик 🔥\x1f" +
      "nariman@example.com\x1f" +
      "feat: поддержка кириллицы и эмодзи ✨\x1f" +
      "diff --git a/src/utf8.ts b/src/utf8.ts\n" +
      "--- a/src/utf8.ts\n" +
      "+++ b/src/utf8.ts\n" +
      "@@ -1,1 +1,2 @@\n" +
      " const привет = 'мир';\n" +
      "+const статус = 'зелёный' as any; // 🚀\n";

    it.each([1, 2, 3, 7, 32, 64])(
      "produces identical parse results for %i-byte chunk stream cuts",
      async (chunkSize) => {
        const fullBuf = Buffer.from(multiByteRaw, "utf8");
        const chunks: Buffer[] = [];
        for (let i = 0; i < fullBuf.length; i += chunkSize) {
          chunks.push(fullBuf.subarray(i, i + chunkSize));
        }

        const parseStream = async (input: Readable) => {
          const commits: any[] = [];
          await parseGitLogStream(input, (c) => commits.push(c));
          return commits;
        };

        const resultFromChunks = await parseStream(Readable.from(chunks));
        const resultFromWhole = await parseStream(Readable.from([fullBuf]));

        expect(resultFromChunks).toEqual(resultFromWhole);
        expect(resultFromChunks[0].authorName).toBe("Нариман Разработчик 🔥");
        expect(resultFromChunks[0].files[0].addedLines[0].line).toContain("const статус = 'зелёный' as any; // 🚀");
      }
    );
  });
});
