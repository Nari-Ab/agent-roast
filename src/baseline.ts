import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import path from "path";
import type { Infraction } from "./types.js";
import { ConfigError } from "./config.js";

export interface FindingBaseline {
  schemaVersion: "1.0.0";
  fingerprintVersion: 1;
  entries: { fingerprint: string; count: number }[];
}

/** Line-independent but multiplicity-aware; adding the same shortcut twice is new. */
export function findingFingerprint(finding: Infraction): string {
  return createHash("sha256")
    .update(JSON.stringify([finding.type, finding.file, finding.lineSnippet?.trim()]))
    .digest("hex");
}

export function createBaseline(findings: Infraction[]): FindingBaseline {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1);
  }
  return {
    schemaVersion: "1.0.0",
    fingerprintVersion: 1,
    entries: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([fingerprint, count]) => ({ fingerprint, count })),
  };
}

export function loadBaseline(filename: string): FindingBaseline {
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error("Expected a regular baseline file under 5 MiB.");
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let content: string;
    try {
      const opened = fs.fstatSync(fd);
      if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("Baseline changed while opening.");
      const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
        if (!read) break;
        size += read;
      }
      const after = fs.fstatSync(fd);
      if (size > 5 * 1024 * 1024 || size !== after.size || opened.mtimeMs !== after.mtimeMs) throw new Error("Baseline changed or exceeded the size limit.");
      content = buffer.subarray(0, size).toString("utf8");
    } finally { fs.closeSync(fd); }
    const parsed = JSON.parse(content);
    if (!parsed || parsed.schemaVersion !== "1.0.0" || parsed.fingerprintVersion !== 1 ||
        !Array.isArray(parsed.entries) || parsed.entries.length > 100_000) {
      throw new Error("Unsupported baseline schema.");
    }
    const seen = new Set<string>();
    for (const entry of parsed.entries) {
      if (!entry || typeof entry.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
          !Number.isSafeInteger(entry.count) || entry.count <= 0 || entry.count > 1_000_000 || seen.has(entry.fingerprint)) {
        throw new Error("Invalid or duplicate baseline entry.");
      }
      seen.add(entry.fingerprint);
    }
    return parsed as FindingBaseline;
  } catch (error) {
    throw new ConfigError(`Cannot load baseline '${filename}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function applyBaseline(findings: Infraction[], baseline: FindingBaseline): {
  findings: Infraction[]; baselineCount: number; staleBaselineCount: number;
} {
  const remaining = new Map(baseline.entries.map(entry => [entry.fingerprint, entry.count]));
  const fresh: Infraction[] = [];
  let baselineCount = 0;
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    const count = remaining.get(fingerprint) || 0;
    if (count > 0) {
      remaining.set(fingerprint, count - 1);
      baselineCount++;
    } else {
      fresh.push(finding);
    }
  }
  return { findings: fresh, baselineCount, staleBaselineCount: [...remaining.values()].reduce((a, b) => a + b, 0) };
}

/** Publish a complete file atomically and refuse to replace an existing baseline. */
export function writeBaseline(filename: string, findings: Infraction[]): void {
  const destination = path.resolve(filename);
  const temporary = path.join(path.dirname(destination), `.agent-roast-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(createBaseline(findings), null, 2) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // link is atomic and fails if another writer published the destination first.
    fs.linkSync(temporary, destination);
  } catch (error) {
    throw new ConfigError(`Cannot write baseline '${filename}' (existing files are preserved): ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}
