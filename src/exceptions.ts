import { findingFingerprint } from "./baseline.js";
import { ConfigError } from "./config.js";
import type { Infraction } from "./types.js";

/** A reviewed allowance for a precise pattern and number of occurrences.
 * No wildcard, inline bypass, source snippet or executable policy is needed. */
export interface FindingException {
  fingerprint: string;
  count: number;
  reason: string;
  expires: string;
}

export interface SuppressedFinding extends Infraction {
  suppression: { reason: string; expires: string };
}

export function validateExceptions(value: unknown): asserts value is FindingException[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 1000) throw new ConfigError("exceptions must be an array with at most 1000 entries.");
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).some(key => !["fingerprint", "count", "reason", "expires"].includes(key)) ||
        typeof entry.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || seen.has(entry.fingerprint) ||
        !Number.isSafeInteger(entry.count) || entry.count < 1 || entry.count > 100_000 ||
        typeof entry.reason !== "string" || !entry.reason.trim() || entry.reason.length > 1000 ||
        /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(entry.reason) ||
        typeof entry.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) ||
        !Number.isFinite(Date.parse(entry.expires)) || new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires) {
      throw new ConfigError("Each exception needs a unique SHA-256 fingerprint, positive count, non-empty single-line reason and real expires date (YYYY-MM-DD).");
    }
    seen.add(entry.fingerprint);
  }
}

/** Line shifts are tolerated; duplicate occurrences beyond the approved count
 * remain actionable. Expiry uses UTC calendar days, inclusive through that day. */
export function applyExceptions(findings: Infraction[], exceptions: FindingException[] = [], now = new Date(), priorOccurrences: ReadonlyMap<string, number> = new Map()): {
  findings: Infraction[]; suppressedFindings: SuppressedFinding[]; expiredExceptionCount: number;
} {
  validateExceptions(exceptions);
  if (!Number.isFinite(now.getTime())) throw new ConfigError("Invalid exception evaluation time.");
  const today = now.toISOString().slice(0, 10);
  const active = new Map(exceptions.filter(entry => entry.expires >= today).map(entry => [entry.fingerprint, { ...entry, remaining: Math.max(0, entry.count - (priorOccurrences.get(entry.fingerprint) ?? 0)) }]));
  const occurrences = new Map(priorOccurrences);
  const actionable: Infraction[] = [];
  const suppressedFindings: SuppressedFinding[] = [];
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    const enriched = { ...finding, fingerprint, occurrence };
    const allowance = active.get(fingerprint);
    if (allowance && allowance.remaining > 0) {
      allowance.remaining--;
      suppressedFindings.push({ ...enriched, suppression: { reason: allowance.reason, expires: allowance.expires } });
    } else actionable.push(enriched);
  }
  return { findings: actionable, suppressedFindings, expiredExceptionCount: exceptions.filter(entry => entry.expires < today).length };
}
