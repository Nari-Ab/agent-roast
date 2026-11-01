import type { DetectorType } from "./types.js";

export interface RuleGuide {
  title: string;
  why: string;
  suggestion: string;
  example: string;
}

/** Review guidance, not automatic edits: legitimate exceptions need context. */
export const RULE_GUIDES: Record<DetectorType, RuleGuide> = {
  "test-focus": {
    title: "Focused test narrows the test run",
    why: "An exclusive test or suite can leave other tests unexecuted while the selected tests pass.",
    suggestion: "Remove .only (or replace fit/fdescribe with it/describe) and run the full suite. Enable your test runner's forbid-only setting in CI when available.",
    example: 'test.only("auth", ...) → test("auth", ...), then run the full suite',
  },
  "test-skip": {
    title: "Skipped or disabled test",
    why: "The test runner may report success without executing this behavior check.",
    suggestion: "Re-enable the test and fix its failure. If a skip is intentional, document its reason and track when to restore it.",
    example: 'it.skip("auth", ...) → it("auth", ...) after fixing the failing behavior',
  },
  "trivial-assert": {
    title: "Assertion that always passes",
    why: "Comparing a constant to itself does not check the implementation and cannot catch regressions.",
    suggestion: "Call the real behavior and assert its output or observable side effect instead of comparing constants.",
    example: "expect(true).toBe(true) → expect(canSignIn(validUser)).toBe(true)",
  },
  "type-escape": {
    title: "Type or linter check bypass",
    why: "A suppression can hide incompatible values or a disabled correctness check. Some suppressions are justified.",
    suggestion: "Narrow or validate the value at the boundary. Keep a suppression only with a specific reason and the smallest possible scope.",
    example: "response as any → parse and validate response before using it",
  },
  "swallowed-error": {
    title: "Error discarded without handling",
    why: "An empty handler makes a failed operation look successful to callers and hides diagnostics.",
    suggestion: "Handle the expected error explicitly, return an observable failure, or rethrow it. Document an intentional best-effort operation.",
    example: "catch (error) {} → catch (error) { throw new Error('Save failed', { cause: error }); }",
  },
  "stub-abandonment": {
    title: "Unimplemented code path",
    why: "A placeholder throws at runtime when a caller reaches the unfinished path. Abstract methods may be intentional.",
    suggestion: "Implement the path or make its unsupported state explicit to callers. Check whether this is an intentional abstract contract.",
    example: "throw new Error('Not implemented') → implement the operation and add a behavior test",
  },
  "assertion-weakened": {
    title: "Test checks less than before",
    why: "A test that keeps its name but loses assertions, or has one replaced by a weaker check, still passes while verifying less behavior.",
    suggestion: "Restore the removed assertion or explain in the PR why that behavior is no longer required. Fix the code under test instead of weakening its check.",
    example: "expect(total).toBe(42) → expect(total).toBeDefined()  (restore the exact check)",
  },
  "test-removed": {
    title: "Test removed",
    why: "Deleting a failing test makes a suite green without fixing the behavior it covered. Removals are legitimate when the feature itself is gone.",
    suggestion: "Confirm the behavior was intentionally removed. If it still exists, restore the test and fix the code.",
    example: "it('rejects expired tokens', ...) deleted while token validation remains in src/",
  },
  "expectation-rewritten": {
    title: "Expected value edited alongside production code",
    why: "Changing an expected value while the test inputs stay the same can mean the test was adjusted to match new output instead of the output being corrected.",
    suggestion: "Verify the new expectation against the requirement, not against the program's current output. Intentional behavior changes should say so in the PR.",
    example: "expect(price(cart)).toBe(100) → toBe(90) with price() changed in the same PR",
  },
  "guard-weakened": {
    title: "Quality gate made easier to pass",
    why: "Lower coverage thresholds, disabled compiler strictness, downgraded lint rules, tolerated CI failures or an always-passing test script let defects through without touching the code.",
    suggestion: "Keep the gate and fix the underlying failure. If the change is deliberate, record the reason and a plan to restore it.",
    example: 'coverageThreshold lines: 80 → 60, "strict": true → false, continue-on-error: true',
  },
  "panic-loop": {
    title: "Rapid overlapping fix commits",
    why: "Repeated short fix cycles can suggest a missing reproduction or feedback loop; timing alone does not prove poor work.",
    suggestion: "Find a minimal reproduction, add a regression test, and verify the complete fix before the next patch.",
    example: "fix → revert → fix → add a reproducer and validate the final behavior",
  },
};
