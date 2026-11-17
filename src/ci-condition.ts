// Whether the condition of a skip names CI. Kept apart from metrics.ts, whose exports are the package's own.

const CI_TOKEN = /\bCI\b|\bisCI\b|GITHUB_ACTIONS/;
// The skips of Python and of the brace languages have always read the narrower set: `isCI` stays a name that they do not know.
export const CI_TOKEN_NARROW = /\bCI\b|\bGITHUB_ACTIONS\b/;

const NOT_CI = /^(?:!\s*process\.env\.(?:CI|GITHUB_ACTIONS)|not\s+os\.(?:environ\.get|getenv)\(\s*(['"])(?:CI|GITHUB_ACTIONS)\1\s*\))$/;

/** Exempt only a standalone negated CI environment lookup. Compound and ambiguous conditions retain the prior CI check. */
export function mentionsCi(condition: string, tokens: RegExp = CI_TOKEN): boolean {
  return tokens.test(condition) && !NOT_CI.test(condition.trim());
}
