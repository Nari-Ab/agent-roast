/**
 * agent-roast — Interactive Workbench
 * Clean, sober developer tooling logic without emojis or marketing fluff.
 */

document.addEventListener("DOMContentLoaded", () => {
  initCopyButtons();
  initScenarioSwitcher();
});

function initCopyButtons() {
  const buttons = document.querySelectorAll(".copy-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-copy") || "npx agent-roast";
      navigator.clipboard.writeText(text).then(() => {
        const label = btn.querySelector(".copy-label");
        const originalText = label ? label.textContent : "Copy";
        btn.classList.add("is-copied");
        if (label) label.textContent = "Copied";
        setTimeout(() => {
          btn.classList.remove("is-copied");
          if (label) label.textContent = originalText;
        }, 1800);
      });
    });
  });
}

const SCENARIOS = {
  "panic-loop": {
    file: "src/client.ts",
    verdict: "roast: The Panic Looper (55/100)",
    lines: [
      { type: "ctx", ln: "41", text: "export async function verifyToken(token: string) {" },
      { type: "del", ln: "42", text: "-  const session = await db.sessions.findUnique({ where: { token } });" },
      { type: "del", ln: "43", text: "-  if (!session || session.expiredAt < new Date()) throw new AuthError();" },
      { type: "hit", ln: "42", text: "+  // bypass typecheck for CI" },
      { type: "hit", ln: "43", text: "+  const payload = jwt.decode(token) as any;" },
      { type: "hit", ln: "44", text: "+  return { userId: payload?.sub ?? 'admin', roles: ['root'] as any };" },
      { type: "ctx", ln: "45", text: "}" },
      { type: "ctx", ln: "46", text: "" },
      { type: "ctx", ln: "47", text: "// git log velocity: 3 commits in 4 minutes" },
      { type: "del", ln: "", text: "-  3df29a1 fix auth crash" },
      { type: "del", ln: "", text: "-  e8421c9 quickfix again" },
      { type: "del", ln: "", text: "-  a910f21 fix type bypass for ci" },
    ],
    terminal: [
      { text: "agent-roast — git discipline audit (304 AI commits)", cls: "t-dim" },
      { text: "" },
      { text: "SCORE: 55 / 100 · The Panic Looper", cls: "t-ask" },
      { text: "  Prone to rapid-fire fix and revert thrashing cycles when wrestling stubborn bugs.", cls: "t-dim" },
      { text: "" },
      { text: "INFRACTIONS DETECTED (42):", cls: "t-deny" },
      { text: "  ● panic-loop (15) — consecutive quick fixes < 15m apart touching same files", cls: "t-deny" },
      { text: "      latest: 3df29a1 -> a910f21 (2m apart) in src/client.ts", cls: "t-dim" },
      { text: "  ● type-escape (19) — compiler type bypasses in added lines", cls: "t-ask" },
      { text: "      src/client.ts:43 — token as any", cls: "t-dim" },
      { text: "  ● test-skip (8) — disabled test suites", cls: "t-deny" },
      { text: "" },
      { text: "Audit complete in 182ms. Zero telemetry.", cls: "t-dim" }
    ]
  },
  "test-skip": {
    file: "tests/client.test.ts",
    verdict: "roast: The Silent Vandal (48/100)",
    lines: [
      { type: "ctx", ln: "12", text: "describe('Session Expiry Validation', () => {" },
      { type: "del", ln: "13", text: "-  it('rejects expired tokens after 15m idle time', async () => {" },
      { type: "hit", ln: "13", text: "+  it.skip('rejects expired tokens after 15m idle time', async () => {" },
      { type: "ctx", ln: "14", text: "    const expired = createMockToken({ expired: true });" },
      { type: "ctx", ln: "15", text: "    await expect(validate(expired)).rejects.toThrow();" },
      { type: "ctx", ln: "16", text: "  });" },
      { type: "ctx", ln: "17", text: "" },
      { type: "del", ln: "18", text: "-  it('rotates refresh token securely', async () => {" },
      { type: "hit", ln: "18", text: "+  it.skip('rotates refresh token securely', async () => {" },
      { type: "ctx", ln: "19", text: "    // test implementation" },
      { type: "ctx", ln: "20", text: "  });" }
    ],
    terminal: [
      { text: "agent-roast — git discipline audit (98 AI commits)", cls: "t-dim" },
      { text: "" },
      { text: "SCORE: 48 / 100 · The Silent Vandal", cls: "t-deny" },
      { text: "  When test suites push back, tends to disable or skip tests to keep pipelines green.", cls: "t-dim" },
      { text: "" },
      { text: "CRITICAL INFRACTIONS:", cls: "t-deny" },
      { text: "  ● test-skip (6) — disabled or skipped test suites in added lines", cls: "t-deny" },
      { text: "      tests/client.test.ts:13 — it.skip('rejects expired tokens')", cls: "t-dim" },
      { text: "      tests/client.test.ts:18 — it.skip('rotates refresh token')", cls: "t-dim" },
      { text: "" },
      { text: "VERDICT: Pipeline turned green by disabling test assertions.", cls: "t-ask" }
    ]
  },
  "type-escape": {
    file: "src/client.ts",
    verdict: "roast: The Any Architect (68/100)",
    lines: [
      { type: "ctx", ln: "88", text: "async function handleResponse(req: Request) {" },
      { type: "del", ln: "89", text: "-  const payload: UserPayload = await req.json();" },
      { type: "del", ln: "90", text: "-  if (!isUserPayload(payload)) return invalidPayload();" },
      { type: "hit", ln: "89", text: "+  // @ts-ignore" },
      { type: "hit", ln: "90", text: "+  const payload = (await req.json()) as any;" },
      { type: "hit", ln: "91", text: "+  const user = payload.data.user as any;" },
      { type: "ctx", ln: "92", text: "   return authorize(user);" },
      { type: "ctx", ln: "93", text: "}" }
    ],
    terminal: [
      { text: "agent-roast — git discipline audit (154 AI commits)", cls: "t-dim" },
      { text: "" },
      { text: "SCORE: 68 / 100 · The Any Architect", cls: "t-ask" },
      { text: "  Leans on compiler bypasses (as any, @ts-ignore) rather than strict type modeling.", cls: "t-dim" },
      { text: "" },
      { text: "INFRACTIONS DETECTED:", cls: "t-ask" },
      { text: "  ● type-escape (14) — compiler type bypasses in added lines", cls: "t-ask" },
      { text: "      src/client.ts:89 — // @ts-ignore", cls: "t-dim" },
      { text: "      src/client.ts:90 — (await req.json()) as any", cls: "t-dim" },
      { text: "      src/client.ts:91 — payload.data.user as any", cls: "t-dim" },
      { text: "" },
      { text: "RECOMMENDATION: Remove 14 `as any` casts to restore strict null checks.", cls: "t-dim" }
    ]
  },
  "clean": {
    file: "src/client.ts",
    verdict: "roast: The Pragmatic Builder (96/100)",
    lines: [
      { type: "ctx", ln: "14", text: "export async function processSession(id: string): Promise<Session> {" },
      { type: "add", ln: "15", text: "+  const session = await db.sessions.findUniqueOrThrow({ where: { id } });" },
      { type: "add", ln: "16", text: "+  const validated = validateTokenIntegrity(session.token);" },
      { type: "add", ln: "17", text: "+  await auditLog.record({ action: 'session.verified', id });" },
      { type: "add", ln: "18", text: "+  return validated;" },
      { type: "ctx", ln: "19", text: "}" }
    ],
    terminal: [
      { text: "agent-roast — git discipline audit (86 AI commits)", cls: "t-dim" },
      { text: "" },
      { text: "SCORE: 96 / 100 · The Pragmatic Builder", cls: "t-allow" },
      { text: "  Spotless discipline. No skipped tests, zero panic loops, and clean type safety.", cls: "t-dim" },
      { text: "" },
      { text: "INFRACTIONS DETECTED (0):", cls: "t-allow" },
      { text: "  ✓ Zero skipped tests detected", cls: "t-allow" },
      { text: "  ✓ Zero compiler type escapes", cls: "t-allow" },
      { text: "  ✓ Spotless commit cadence (>1h intentional iterations)", cls: "t-allow" },
      { text: "" },
      { text: "VERDICT: Clean engineering. Ready to merge with confidence.", cls: "t-dim" }
    ]
  },
  "pr-gate": {
    file: "tests/auth.test.ts",
    verdict: "ci: FAILED (--fail-on test-skip violated)",
    lines: [
      { type: "ctx", ln: "23", text: "describe('Bearer token authentication', () => {" },
      { type: "del", ln: "24", text: "-  it('verifies RSA cryptographic signature', async () => {" },
      { type: "hit", ln: "24", text: "+  it.skip('verifies RSA cryptographic signature', async () => {" },
      { type: "ctx", ln: "25", text: "    const res = await client.request('/api/v1/user');" },
      { type: "ctx", ln: "26", text: "    expect(res.status).toBe(200);" },
      { type: "ctx", ln: "27", text: "  });" },
      { type: "ctx", ln: "28", text: "});" }
    ],
    terminal: [
      { text: "::notice::agent-roast auditing range: origin/main..HEAD (PR delta mode)", cls: "t-dim" },
      { text: "audited 3 commits in pull request branch...", cls: "t-dim" },
      { text: "" },
      { text: "::error file=tests/auth.test.ts,line=24::[test-skip] skipped test added: it.skip('verifies RSA cryptographic signature')", cls: "t-deny" },
      { text: "" },
      { text: "INFRACTIONS DETECTED IN PR:", cls: "t-deny" },
      { text: "  ● test-skip (1) — disabled test suite added in PR", cls: "t-deny" },
      { text: "      tests/auth.test.ts:24 — it.skip('verifies RSA cryptographic signature')", cls: "t-dim" },
      { text: "" },
      { text: "FAIL: Blocking failure requested for rule: test-skip", cls: "t-deny" },
      { text: "Error: Process completed with exit code 1.", cls: "t-deny" }
    ]
  }
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

    // Render Diff
    codeLines.innerHTML = "";
    data.lines.forEach((l) => {
      const li = document.createElement("li");

      const lnSpan = document.createElement("span");
      lnSpan.className = "ed-ln";
      lnSpan.textContent = l.ln;

      const codeSpan = document.createElement("span");
      if (l.type === "add") codeSpan.className = "line-add";
      else if (l.type === "del") codeSpan.className = "line-del";
      else if (l.type === "hit") codeSpan.className = "line-hit";
      else codeSpan.className = "line-ctx";
      codeSpan.textContent = l.text;

      li.appendChild(lnSpan);
      li.appendChild(codeSpan);
      codeLines.appendChild(li);
    });

    // Render Terminal
    termView.innerHTML = "";
    data.terminal.forEach((item) => {
      const div = document.createElement("div");
      div.className = `t-line ${item.cls || ""}`;
      div.textContent = item.text || " ";
      termView.appendChild(div);
    });
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const key = btn.getAttribute("data-scenario");
      loadScenario(key);
    });
  });

  // Default scenario
  loadScenario("panic-loop");
}
