import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { changedTreeFiles, readBlob, readGit, reviewRefs } from "../src/snapshot.js";

let dir: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-snapshot-"));
  git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid"); git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "auth.ts"), "const ok = true;\n"); git("add", "."); git("commit", "-m", "base");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("immutable, bounded Git source reads", () => {
  it("reads blobs by fixed OID and rejects argument-like object identities", async () => {
    const oid = git("rev-parse", "HEAD:auth.ts");
    fs.writeFileSync(path.join(dir, "auth.ts"), "changed worktree");
    expect((await readBlob(dir, oid)).toString()).toBe("const ok = true;\n");
    await expect(readBlob(dir, "--filters")).rejects.toThrow(/identity/);
  });
  it("ignores ambient repository redirection when an explicit checkout is supplied", async () => {
    const old = process.env.GIT_DIR;
    try {
      process.env.GIT_DIR = path.join(dir, "nonexistent-other-repository");
      const result = await reviewRefs(dir, "HEAD", "HEAD");
      expect(result.baseSha).toBe(result.headSha);
    } finally {
      if (old === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = old;
    }
  });
  it("limits both advertised source sizes and subprocess output", async () => {
    const oid = git("rev-parse", "HEAD:auth.ts");
    await expect(readBlob(dir, oid, undefined, 2)).rejects.toThrow(/limit/);
    await expect(readGit(dir, ["cat-file", "blob", oid], undefined, 2)).rejects.toThrow(/limit/);
  });
  it("refuses partial clones before accessing missing remote objects", async () => {
    git("config", "remote.origin.promisor", "true"); git("config", "remote.origin.url", "ext::touch SHOULD_NOT_EXIST");
    await expect(reviewRefs(dir, "HEAD", "HEAD")).rejects.toThrow(/non-partial clone/);
    expect(fs.existsSync(path.join(dir, "SHOULD_NOT_EXIST"))).toBe(false);
  });
  it("rejects missing and unrelated refs rather than comparing arbitrary trees", async () => {
    await expect(reviewRefs(dir, "--help", "HEAD")).rejects.toThrow(/Cannot resolve/);
    const base = git("rev-parse", "HEAD"); git("checkout", "--orphan", "unrelated");
    git("rm", "-rf", "."); fs.writeFileSync(path.join(dir, "other.ts"), "other"); git("add", "."); git("commit", "-m", "unrelated");
    await expect(reviewRefs(dir, base, "HEAD")).rejects.toThrow(/merge-base/);
  });
  it("refuses ambiguous criss-cross merge ancestry", async () => {
    const root = git("rev-parse", "HEAD"); const tree = git("rev-parse", "HEAD^{tree}");
    const a = git("commit-tree", tree, "-p", root, "-m", "a");
    const b = git("commit-tree", tree, "-p", root, "-m", "b");
    const c = git("commit-tree", tree, "-p", a, "-p", b, "-m", "c");
    const d = git("commit-tree", tree, "-p", b, "-p", a, "-m", "d");
    await expect(reviewRefs(dir, c, d)).rejects.toThrow(/exactly one merge base/);
  });
  it("does not execute configured external diff or fsmonitor programs", async () => {
    const base = git("rev-parse", "HEAD"); fs.writeFileSync(path.join(dir, "auth.ts"), "const value = thing as any;\n"); git("add", "."); git("commit", "-m", "change");
    fs.writeFileSync(path.join(dir, "evil.sh"), "#!/bin/sh\ntouch SHOULD_NOT_EXIST\n"); fs.chmodSync(path.join(dir, "evil.sh"), 0o755);
    git("config", "diff.external", path.join(dir, "evil.sh")); git("config", "core.fsmonitor", path.join(dir, "evil.sh"));
    expect(await changedTreeFiles(dir, base, git("rev-parse", "HEAD"))).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "SHOULD_NOT_EXIST"))).toBe(false);
  });
  it("cancels an active read without writing to the checkout", async () => {
    const controller = new AbortController();
    const promise = readGit(dir, ["log", "--oneline"], controller.signal);
    controller.abort(); await expect(promise).rejects.toThrow(/cancelled/);
    expect(git("status", "--porcelain")).toBe("");
  });
  it("does not silently truncate an over-limit changed-file inventory", async () => {
    const base = git("rev-parse", "HEAD");
    for (let i = 0; i < 1001; i++) fs.writeFileSync(path.join(dir, `source-${i}.ts`), "const ok = true;\n");
    git("add", "."); git("commit", "-m", "large change");
    await expect(changedTreeFiles(dir, base, git("rev-parse", "HEAD"))).rejects.toThrow(/1000 changed-file/);
  });
});
