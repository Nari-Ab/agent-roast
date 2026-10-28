/** Illustrative examples only. Analysis remains in the installed offline CLI. */
document.addEventListener("DOMContentLoaded", () => {
  initCopyButtons();
  initScenarioSwitcher();
});

function initCopyButtons() {
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "npx agent-roast check";
      const label = btn.querySelector(".copy-label");
      const originalText = label ? label.textContent : "Copy";
      if (label) label.setAttribute("aria-live", "polite");
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add("is-copied");
        if (label) label.textContent = "Copied";
      } catch {
        // A browser may deny clipboard access. Keep a visible, selectable fallback.
        const command = document.getElementById(btn.getAttribute("data-select"));
        if (command) {
          const range = document.createRange();
          range.selectNodeContents(command);
          const selection = window.getSelection();
          if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        }
        if (label) label.textContent = "Copy manually";
      }
      setTimeout(() => {
        btn.classList.remove("is-copied");
        if (label) label.textContent = originalText;
      }, 2400);
    });
  });
}

// These authored examples explain patterns, not customer outcomes or timings.
const SCENARIOS = {
  "panic-loop": {
    file: "src/save.ts",
    verdict: "review: new empty catch detected",
    lines: [
      { type: "ctx", ln: "1", text: "try { save(); } catch (error) {" },
      { type: "del", ln: "2", text: "-  report(error);" },
      { type: "ctx", ln: "2", text: "}" },
    ],
    terminal: [
      { text: "$ agent-roast review --base origin/main --fail-on swallowed-error", cls: "t-dim" },
      { text: "Illustrative output", cls: "t-dim" },
      { text: "BLOCKED: new swallowed-error finding", cls: "t-deny" },
      { text: "src/save.ts:1 — empty multi-line catch block", cls: "t-deny" },
      { text: "Next: handle the expected error, return an observable failure, or rethrow.", cls: "t-dim" },
      { text: "Full source comparison detects this deletion-only regression.", cls: "t-dim" },
    ],
  },
  "test-skip": {
    file: "tests/auth.test.ts",
    verdict: "review: new skipped test detected",
    lines: [
      { type: "del", ln: "1", text: "- it('rejects an expired token', async () => {" },
      { type: "hit", ln: "1", text: "+ it.skip('rejects an expired token', async () => {" },
      { type: "ctx", ln: "2", text: "  await expect(validate(expiredToken)).rejects.toThrow();" },
      { type: "ctx", ln: "3", text: "});" },
    ],
    terminal: [
      { text: "$ agent-roast review --base origin/main", cls: "t-dim" },
      { text: "Illustrative output", cls: "t-dim" },
      { text: "BLOCKED: new test-skip finding", cls: "t-deny" },
      { text: "tests/auth.test.ts:1 — it.skip('rejects an expired token', ...)", cls: "t-deny" },
      { text: "Next: re-enable the test and fix its failure, or review an intentional skip.", cls: "t-dim" },
    ],
  },
  "type-escape": {
    file: "src/client.ts",
    verdict: "review: advisory type-escape finding",
    lines: [
      { type: "hit", ln: "1", text: "+ const user = response.data as any;" },
      { type: "ctx", ln: "2", text: "return authorize(user);" },
    ],
    terminal: [
      { text: "$ agent-roast review --base origin/main", cls: "t-dim" },
      { text: "Illustrative output", cls: "t-dim" },
      { text: "WARN [type-escape] src/client.ts:1", cls: "t-ask" },
      { text: "Next: narrow or validate the value at the boundary.", cls: "t-dim" },
      { text: "This rule is advisory by default; configure severity to block it.", cls: "t-dim" },
      { text: "Passing this gate does not certify authorization or runtime correctness.", cls: "t-dim" },
    ],
  },
  "clean": {
    file: "src/client.ts",
    verdict: "check: no blocking patterns detected",
    lines: [
      { type: "add", ln: "1", text: "+ const user = parseUser(response.data);" },
      { type: "add", ln: "2", text: "+ return authorize(user);" },
    ],
    terminal: [
      { text: "$ agent-roast check", cls: "t-dim" },
      { text: "Illustrative output", cls: "t-dim" },
      { text: "PASSED: no new blocking findings.", cls: "t-allow" },
      { text: "No supported shortcut patterns were found in this example.", cls: "t-dim" },
      { text: "Compile, run tests and review behavior; this is a focused heuristic aid.", cls: "t-dim" },
    ],
  },
  "pr-gate": {
    file: "tests/auth.test.ts",
    verdict: "review: focused test narrows the run",
    lines: [
      { type: "del", ln: "1", text: "- test('sign in', async () => {" },
      { type: "hit", ln: "1", text: "+ test.only('sign in', async () => {" },
      { type: "ctx", ln: "2", text: "  expect(await signIn(validUser)).toBe(true);" },
      { type: "ctx", ln: "3", text: "});" },
    ],
    terminal: [
      { text: "$ agent-roast --staged", cls: "t-dim" },
      { text: "Illustrative output", cls: "t-dim" },
      { text: "BLOCKED: new test-focus finding", cls: "t-deny" },
      { text: "tests/auth.test.ts:1 — test.only('sign in', ...)", cls: "t-deny" },
      { text: "Next: remove .only and run the full suite.", cls: "t-dim" },
      { text: "Enable your test runner's native forbid-only option when available.", cls: "t-dim" },
    ],
  },
};

function initScenarioSwitcher() {
  const buttons = document.querySelectorAll(".sc-btn");
  const tabTitle = document.getElementById("active-tab-title");
  const codeLines = document.getElementById("diff-code-lines");
  const termView = document.getElementById("term-view");
  const statusVerdict = document.getElementById("st-verdict");
  if (!codeLines || !termView) return;

  function loadScenario(key) {
    const data = SCENARIOS[key];
    if (!data) return;
    if (tabTitle) tabTitle.textContent = data.file;
    if (statusVerdict) statusVerdict.textContent = data.verdict;
    codeLines.innerHTML = "";
    data.lines.forEach((line) => {
      const li = document.createElement("li");
      const number = document.createElement("span");
      number.className = "ed-ln";
      number.textContent = line.ln;
      const code = document.createElement("span");
      code.className = line.type === "add" ? "line-add" : line.type === "del" ? "line-del" : line.type === "hit" ? "line-hit" : "line-ctx";
      code.textContent = line.text;
      li.appendChild(number); li.appendChild(code); codeLines.appendChild(li);
    });
    termView.innerHTML = "";
    data.terminal.forEach((item) => {
      const div = document.createElement("div");
      div.className = `t-line ${item.cls || ""}`;
      div.textContent = item.text || " ";
      termView.appendChild(div);
    });
  }
  buttons.forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.classList.contains("is-active") ? "true" : "false");
    btn.addEventListener("click", () => {
      buttons.forEach((other) => { other.classList.remove("is-active"); other.setAttribute("aria-pressed", "false"); });
      btn.classList.add("is-active"); btn.setAttribute("aria-pressed", "true");
      loadScenario(btn.getAttribute("data-scenario"));
    });
  });
  loadScenario("panic-loop");
}
