import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import path from "path";
import type { Infraction } from "./types.js";
import { ConfigError } from "./config.js";
import { readRegularFile } from "./file-read.js";

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
    const content = new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(filename, 5 * 1024 * 1024));
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
    const baseline = createBaseline(findings);
    const serialized = JSON.stringify(baseline, null, 2) + "\n";
    if (Buffer.byteLength(serialized, "utf8") > 5 * 1024 * 1024 || baseline.entries.length > 100_000 || baseline.entries.some(entry => entry.count > 1_000_000)) {
      throw new Error("Baseline exceeds the supported read limits; narrow the adopted scope.");
    }
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, serialized);
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
