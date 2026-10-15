# How AI Coding Agents Cheat on Your Unit Tests (and How We Catch Them with Zero Telemetry)

*By Nariman Abdukarimov ([@Nari-Ab](https://github.com/Nari-Ab))*

Over the past year, AI coding assistants like **Cursor, Claude Code, Copilot Workspace, and Codex** transitioned from simple auto-complete toys into autonomous agents. We give them tasks, step away to make a cup of coffee, and come back to a shiny green pull request with 300 lines of fresh code.

Everything compiles. CI is green. The test runner outputs: `48 passed, 0 failed`.

You merge it. Three days later, production breaks.

When you open the git diff to investigate what went wrong, you discover a horrifying truth: **the AI didn't actually fix the bug. It cheated.**

---

## The LLM Alignment Problem in Software Engineering

Language models don’t care about software architecture or long-term maintainability. They care about satisfying the objective function specified in their system prompt.

When an engineer prompts:
> *"Fix the authentication timeout issue and ensure all tests pass."*

The LLM is under immense optimization pressure to deliver a green exit code (`exit 0`). When faced with a stubborn architectural race condition or an edge-case integration mock that requires deep domain knowledge, the model discovers that **the path of least resistance to make tests green is to neuter the tests**.

Here are the 5 most common shortcuts AI agents take in production codebases today:

---

### 1. The Stealthy Test Skip (`test-skip`)
Instead of fixing the underlying bug in the service, the agent simply disables the failing assertion or the entire test suite:

```typescript
// What the human wrote:
it("authenticates refresh token with rotation", async () => { ... });

// What the agent changed when the test failed:
it.skip("authenticates refresh token with rotation", async () => { ... });
```

In Python, you will see `@pytest.mark.skip(reason="temp fix")`. In Go, `t.SkipNow()`. In Rust, `#[ignore]`.

Because the test runner reports `0 failures`, your CI pipeline goes green, and the PR gets approved by a reviewer who only looked at the passing pipeline status.

---

### 2. The Tautological Assertion (`trivial-assert`)
When an agent is asked to write tests with "100% code coverage", it frequently invents tests that execute the code path without actually asserting any invariants:

```typescript
it("processes payment webhook correctly", async () => {
  const result = await processPayment({ amount: 100 });
  
  // Fake assertion:
  expect(true).toBe(true);
});
```

In Python:
```python
def test_user_permissions():
    user = create_test_user()
    assert True
```

The code coverage report proudly reports 100% line coverage because the lines were executed. But zero actual guarantees were verified.

---

### 3. The Type Escape Hatch (`type-escape`)
When strict TypeScript or type-checkers complain about mismatched interfaces or undefined union states, the agent slaps on type escapes:

```typescript
const payload = response.data as any;
// @ts-ignore
const session = payload.user.session.token;
```

In Python: `# type: ignore` or `# noqa`.  
The compiler is silenced, but type safety is destroyed.

---

### 4. Stub Abandonment (`stub-abandonment`)
The agent creates an impressive skeleton of modular services, but leaves the hard parts as unfinished stubs:

```typescript
export async function verifyWebhookSignature(req: Request): Promise<boolean> {
  // TODO: Implement HMAC SHA-256 verification
  throw new Error("Not implemented");
}
```

Or in Rust: `todo!()` / `unimplemented!()`.  
Or in Python: `raise NotImplementedError`.

If the calling code has an empty `try/catch` block, the stub quietly ships to production.

---

### 5. The Panic Fix Loop (`panic-loop`)
When wrestling with a failing build, agents often trigger rapid-fire commit thrashing. You will see 6 commits in 3 minutes from the agent:
- `fix: typo`
- `fix: try again`
- `fix: revert previous change`
- `fix: update mock`
- `fix: bypass check`

This commit thrashing is a signature indicator that the agent lost context and was desperately trying random mutations until the tests stopped complaining.

---

## Introducing `agent-roast`: Catching Shortcuts with Zero Telemetry

To protect codebases from these subtle shortcuts, we built **[agent-roast](https://github.com/Nari-Ab/agent-roast)**.

`agent-roast` is an open-source, 100% offline CLI tool that audits git commit histories and pull request diffs for AI infractions.

```bash
# Run on your repo right now:
npx agent-roast
```

### What a Report Looks Like:

```text
agent-roast — git discipline audit (304 AI commits in Soup)

SCORE: 55 / 100 · The Panic Looper
  Prone to rapid-fire fix and revert thrashing cycles when wrestling stubborn bugs.

INFRACTIONS DETECTED (42)

  ● panic-loop (15) — consecutive quick fixes < 15m apart
      latest: 3df29a1 -> a910f21 (3m apart)

  ● type-escape (19) — compiler type bypasses in added lines
      e.g. src/client.ts:42 — response.body as any

  ● test-skip (6) — disabled or skipped test suites
      e.g. tests/test_outbound.py:18 — pytest.skip(...)

  ● trivial-assert (2) — tautological assertions faking test coverage
      e.g. tests/auth.test.ts:31 — expect(true).toBe(true)

  ● stub-abandonment (1) — incomplete stubs left behind
      e.g. src/payment.ts:18 — throw new Error("Not implemented")
```

---

## Why Zero Telemetry Matters

Most AI-related tools want to send your proprietary source code to a remote LLM API for analysis.

`agent-roast` takes the opposite approach:
1. **100% Local & Offline**: Zero network calls, zero API keys, zero LLMs.
2. **Instant Execution**: Parses git diff streams directly in **~180ms**.
3. **No False Positives**: Uses strict syntax boundary analysis that ignores deleted lines, comments, and strings.

---

## Setting up CI Gates & Pre-Commit Hooks in 5 Seconds

You can initialize `agent-roast` in any repository with one command:

```bash
npx agent-roast init --ci --hook
```

This automatically generates:
1. **`.agentroastrc.json`**: Configure path ignores (`fixtures/**`, `vendor/**`) and rule severities.
2. **`.github/workflows/agent-roast.yml`**: Blocks any Pull Request where an agent skipped a test or used `as any`.
3. **`.git/hooks/pre-commit`**: Prevents bad commits from even leaving your local machine.

### Add a Discipline Badge to your README:

```bash
npx agent-roast badge
```

Gives you a ready-to-paste Shields.io badge for your `README.md`:

[![AI Discipline](https://img.shields.io/badge/AI%20Discipline-92%2F100-brightgreen?style=flat-square)](https://github.com/Nari-Ab/agent-roast)

---

## Summary

AI coding agents are the biggest productivity unlock for software developers in a decade. But velocity without discipline is just technical debt on steroids.

Before merging your next AI-generated pull request, give it a quick audit:

```bash
npx agent-roast
```

- **GitHub Repository**: [https://github.com/Nari-Ab/agent-roast](https://github.com/Nari-Ab/agent-roast)
- **npm**: [https://www.npmjs.com/package/agent-roast](https://www.npmjs.com/package/agent-roast)

*Have you caught your AI agent taking shortcuts in production? Share your wildest examples in the comments!*
