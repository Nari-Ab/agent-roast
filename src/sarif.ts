import { createRequire } from "module";
import { ConfigError } from "./config.js";
import { findingFingerprint } from "./baseline.js";
import { RULE_GUIDES } from "./rules.js";
import { VALID_DETECTORS } from "./types.js";
import type { CheckResult, ReviewResult } from "./types.js";

const require = createRequire(import.meta.url);
const version: string = require("../package.json").version;

/** Offline SARIF 2.1.0, with relative URIs and explicit incomplete-run status.
 * Snippets are omitted to avoid embedding source code in integration artifacts. */
export function formatSarif(report: CheckResult | ReviewResult): string {
  const occurrences = new Map<string, number>();
  const results = report.infractions.map(finding => {
    const filename = finding.file;
    if (!filename || filename.startsWith("/") || filename.split("/").includes("..") || /^[a-z]:/i.test(filename)) {
      throw new ConfigError("SARIF needs repository-relative finding paths.");
    }
    const fingerprint = findingFingerprint(finding);
    const occurrence = (occurrences.get(fingerprint) || 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return {
      ruleId: finding.type,
      ruleIndex: VALID_DETECTORS.indexOf(finding.type),
      level: report.failedRules.includes(finding.type) ? "error" : "warning",
      message: { text: `${finding.reason}. ${finding.suggestion || RULE_GUIDES[finding.type].suggestion}` },
      locations: [{ physicalLocation: {
        artifactLocation: { uri: filename.split("/").map(segment => encodeURIComponent(segment)).join("/") },
        region: { startLine: Math.max(1, finding.lineNumber || 1) },
      } }],
      partialFingerprints: { "agentRoastFinding/v1": `${fingerprint}:${occurrence}` },
      ...(report.mode === "review" ? { baselineState: "new" } : {}),
    };
  });
  return JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: {
        name: "agent-roast", semanticVersion: version,
        informationUri: "https://github.com/Nari-Ab/agent-roast",
        rules: VALID_DETECTORS.map(rule => ({
          id: rule, name: rule,
          shortDescription: { text: RULE_GUIDES[rule].title },
          fullDescription: { text: RULE_GUIDES[rule].why },
          help: { text: `${RULE_GUIDES[rule].suggestion}\nExample: ${RULE_GUIDES[rule].example}` },
          defaultConfiguration: { level: "warning" },
          properties: { tags: ["maintainability", "code-review"] },
        })),
      } },
      invocations: [{
        executionSuccessful: report.complete,
        exitCode: report.exitCode,
        toolExecutionNotifications: report.skippedFiles.map(skipped => ({
          level: "error", message: { text: `Not inspected: ${skipped.file}. ${skipped.reason}` },
        })),
      }],
      results,
      properties: report.mode === "review" ? {
        scope: "introduced findings in changed files", baseSha: report.baseSha, headSha: report.headSha,
        mergeBaseSha: report.mergeBaseSha, policySha: report.policySha,
        unchangedFindings: report.unchangedCount, removedFindings: report.removedFindings.length,
      } : { scope: "current source", acceptedBaselineFindings: report.baselineCount },
    }],
  }, null, 2);
}
