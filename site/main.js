/**
 * agent-roast Landing Page Interactive Engine
 */

document.addEventListener("DOMContentLoaded", () => {
  initClipboardHandlers();
  initScenarioTabs();
  initScoreSimulator();
});

/* --------------------------------------------------------------------------
   1. Clipboard Command Helpers
   -------------------------------------------------------------------------- */
function initClipboardHandlers() {
  const pills = [
    document.getElementById("nav-copy-pill"),
    document.getElementById("hero-copy-pill"),
    document.getElementById("bottom-copy-pill")
  ];

  pills.forEach((pill) => {
    if (!pill) return;
    pill.addEventListener("click", () => {
      const cmd = pill.getAttribute("data-cmd") || "npx agent-roast";
      navigator.clipboard.writeText(cmd).then(() => {
        pill.classList.add("copied");
        setTimeout(() => {
          pill.classList.remove("copied");
        }, 2000);
      });
    });
  });
}

/* --------------------------------------------------------------------------
   2. Interactive Scenario Workbench
   -------------------------------------------------------------------------- */
const SCENARIOS = {
  "panic-loop": {
    filename: "src/auth/jwt.ts (commit a910f21 by Cursor)",
    diffLines: [
      { type: "context", ln: "41", text: " export async function verifySession(token: string) {" },
      { type: "del", ln: "42", text: "-  const session = await db.sessions.findUnique({ where: { token } });" },
      { type: "del", ln: "43", text: "-  if (!session || session.expiredAt < new Date()) throw new AuthError();" },
      { type: "add", ln: "42", text: "+  // fix: force pass auth check in CI" },
      { type: "add", ln: "43", text: "+  const payload = jwt.decode(token) as any; // FIXME" },
      { type: "hit", ln: "44", text: "+  return { userId: payload?.sub ?? 'root', roles: ['admin'] as any };" },
      { type: "context", ln: "45", text: " }" },
      { type: "context", ln: "46", text: " " },
      { type: "context", ln: "47", text: " // git history in last 5 minutes:" },
      { type: "del", ln: "", text: "-  commit 3df29a1 'fix auth crash'" },
      { type: "del", ln: "", text: "-  commit e8421c9 'quickfix again'" },
      { type: "del", ln: "", text: "-  commit a910f21 'fix type bypass for ci'" },
    ],
    terminalOutput: [
      { text: "agent-roast — git discipline audit (304 AI commits in repo)", cls: "term-dim" },
      { text: "" },
      { text: "SCORE: 55 / 100 · The Panic Looper", cls: "term-warning" },
      { text: "  Prone to rapid-fire fix thrashing cycles when wrestling stubborn bugs.", cls: "term-dim" },
      { text: "" },
      { text: "INFRACTIONS DETECTED (42):", cls: "term-danger" },
      { text: "  ● panic-loop (15)  consecutive quick fixes < 15m apart touching same files", cls: "term-danger" },
      { text: "      latest: 3df29a1 -> a910f21 (2m apart) in src/auth/jwt.ts", cls: "term-dim" },
      { text: "  ● type-escape (19)  compiler type bypasses in added lines", cls: "term-warning" },
      { text: "      e.g. src/auth/jwt.ts:43 — token as any", cls: "term-dim" },
      { text: "  ● test-skip (8)     disabled test suites", cls: "term-danger" },
      { text: "" },
      { text: "SUMMARY: 100% Local · 182ms · 0 Telemetry", cls: "term-cyan" }
    ]
  },
  "test-skip": {
    filename: "tests/auth/expiry.test.ts (commit c4b2210)",
    diffLines: [
      { type: "context", ln: "12", text: " describe('JWT Expiry Validation', () => {" },
      { type: "del", ln: "13", text: "-  it('rejects expired tokens after 15m idle time', async () => {" },
      { type: "hit", ln: "13", text: "+  it.skip('rejects expired tokens after 15m idle time', async () => {" },
      { type: "context", ln: "14", text: "     const expired = createMockToken({ expired: true });" },
      { type: "context", ln: "15", text: "     await expect(validate(expired)).rejects.toThrow();" },
      { type: "context", ln: "16", text: "   });" },
      { type: "context", ln: "17", text: " " },
      { type: "del", ln: "18", text: "-  it('rotates refresh token securely', async () => {" },
      { type: "hit", ln: "18", text: "+  it.skip('rotates refresh token securely', async () => {" },
      { type: "context", ln: "19", text: "     // test body..." },
      { type: "context", ln: "20", text: "   });" },
    ],
    terminalOutput: [
      { text: "agent-roast — git discipline audit (98 AI commits)", cls: "term-dim" },
      { text: "" },
      { text: "SCORE: 48 / 100 · The Silent Vandal", cls: "term-danger" },
      { text: "  When test suites push back, tends to disable or skip tests to keep pipelines green.", cls: "term-dim" },
      { text: "" },
      { text: "CRITICAL INFRACTIONS:", cls: "term-danger" },
      { text: "  ● test-skip (6)  disabled or skipped test suites in added lines", cls: "term-danger" },
      { text: "      tests/auth/expiry.test.ts:13 — it.skip('rejects expired tokens')", cls: "term-dim" },
      { text: "      tests/auth/expiry.test.ts:18 — it.skip('rotates refresh token')", cls: "term-dim" },
      { text: "" },
      { text: "VERDICT: Pipeline turned green by disabling assertions.", cls: "term-warning" }
    ]
  },
  "type-escape": {
    filename: "src/api/handler.ts (commit e7194f2)",
    diffLines: [
      { type: "context", ln: "88", text: " async function handleWebhook(req: Request) {" },
      { type: "del", ln: "89", text: "-  const payload: StripeEvent = await req.json();" },
      { type: "del", ln: "90", text: "-  if (!isStripeEvent(payload)) return invalidPayload();" },
      { type: "add", ln: "89", text: "+  // @ts-ignore" },
      { type: "hit", ln: "90", text: "+  const payload = (await req.json()) as any;" },
      { type: "add", ln: "91", text: "+  const customer = payload.data.object.customer as any;" },
      { type: "context", ln: "92", text: "   return fulfill(customer);" },
      { type: "context", ln: "93", text: " }" }
    ],
    terminalOutput: [
      { text: "agent-roast — git discipline audit (154 AI commits)", cls: "term-dim" },
      { text: "" },
      { text: "SCORE: 68 / 100 · The Any Architect", cls: "term-warning" },
      { text: "  Leans on compiler bypasses (as any, @ts-ignore) rather than strict type modeling.", cls: "term-dim" },
      { text: "" },
      { text: "INFRACTIONS DETECTED:", cls: "term-warning" },
      { text: "  ● type-escape (14)  compiler type bypasses in added lines", cls: "term-warning" },
      { text: "      src/api/handler.ts:89 — // @ts-ignore", cls: "term-dim" },
      { text: "      src/api/handler.ts:90 — (await req.json()) as any", cls: "term-dim" },
      { text: "      src/api/handler.ts:91 — object.customer as any", cls: "term-dim" },
      { text: "" },
      { text: "RECOMMENDATION: Remove 14 `as any` casts to restore strict null checks.", cls: "term-cyan" }
    ]
  },
  "clean": {
    filename: "src/billing/service.ts (commit f41a980)",
    diffLines: [
      { type: "context", ln: "14", text: " export async function processBilling(id: string): Promise<Invoice> {" },
      { type: "add", ln: "15", text: "+  const account = await db.accounts.findUniqueOrThrow({ where: { id } });" },
      { type: "add", ln: "16", text: "+  const invoice = await paymentGateway.createInvoice(account);" },
      { type: "add", ln: "17", text: "+  await auditLog.record({ action: 'invoice.created', target: id });" },
      { type: "add", ln: "18", text: "+  return invoice;" },
      { type: "context", ln: "19", text: " }" }
    ],
    terminalOutput: [
      { text: "agent-roast — git discipline audit (86 AI commits)", cls: "term-dim" },
      { text: "" },
      { text: "SCORE: 96 / 100 · The Pragmatic Builder", cls: "term-success" },
      { text: "  Spotless discipline. No skipped tests, zero panic loops, and clean type safety.", cls: "term-dim" },
      { text: "" },
      { text: "INFRACTIONS DETECTED (0):", cls: "term-success" },
      { text: "  ✓ Zero skipped tests detected", cls: "term-success" },
      { text: "  ✓ Zero compiler type escapes", cls: "term-success" },
      { text: "  ✓ Spotless commit cadence (>1h intentional iterations)", cls: "term-success" },
      { text: "" },
      { text: "VERDICT: Clean engineering. Ready to merge with confidence.", cls: "term-cyan" }
    ]
  }
};

function initScenarioTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  const fileNameEl = document.getElementById("diff-file-name");
  const diffEl = document.getElementById("diff-content");
  const termEl = document.getElementById("term-content");

  if (!diffEl || !termEl) return;

  function renderScenario(key) {
    const data = SCENARIOS[key];
    if (!data) return;

    if (fileNameEl) fileNameEl.textContent = data.filename;

    // Render Diff Lines
    diffEl.innerHTML = "";
    data.diffLines.forEach((l) => {
      const lineDiv = document.createElement("div");
      lineDiv.className = "diff-line";

      const lnSpan = document.createElement("span");
      lnSpan.className = "diff-ln";
      lnSpan.textContent = l.ln;

      const codeSpan = document.createElement("span");
      if (l.type === "add") codeSpan.className = "diff-add";
      else if (l.type === "del") codeSpan.className = "diff-del";
      else if (l.type === "hit") codeSpan.className = "diff-hit";
      codeSpan.textContent = l.text;

      lineDiv.appendChild(lnSpan);
      lineDiv.appendChild(codeSpan);
      diffEl.appendChild(lineDiv);
    });

    // Render Terminal Lines
    termEl.innerHTML = "";
    data.terminalOutput.forEach((item) => {
      const p = document.createElement("div");
      p.className = `term-line ${item.cls || ""}`;
      p.textContent = item.text || " ";
      termEl.appendChild(p);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const scenarioKey = tab.getAttribute("data-scenario");
      renderScenario(scenarioKey);
    });
  });

  // Default scenario
  renderScenario("panic-loop");
}

/* --------------------------------------------------------------------------
   3. Interactive Score Simulator
   -------------------------------------------------------------------------- */
function initScoreSimulator() {
  const slSkips = document.getElementById("sl-skips");
  const slEscapes = document.getElementById("sl-escapes");
  const slPanics = document.getElementById("sl-panics");
  const slSwallow = document.getElementById("sl-swallow");

  const valSkips = document.getElementById("val-skips");
  const valEscapes = document.getElementById("val-escapes");
  const valPanics = document.getElementById("val-panics");
  const valSwallow = document.getElementById("val-swallow");

  const scoreNum = document.getElementById("sim-score-num");
  const ringFill = document.getElementById("sim-ring-fill");
  const titleEl = document.getElementById("sim-archetype-title");
  const descEl = document.getElementById("sim-archetype-desc");
  const penaltyEl = document.getElementById("sim-total-penalty");

  if (!slSkips || !scoreNum) return;

  function update() {
    const nSkips = parseInt(slSkips.value, 10);
    const nEscapes = parseInt(slEscapes.value, 10);
    const nPanics = parseInt(slPanics.value, 10);
    const nSwallow = parseInt(slSwallow.value, 10);

    valSkips.textContent = nSkips;
    valEscapes.textContent = nEscapes;
    valPanics.textContent = nPanics;
    valSwallow.textContent = nSwallow;

    // Weight points calibrated:
    const skipPts = nSkips * 15;
    const swallowPts = nSwallow * 10;
    const panicPts = nPanics * 8;
    const escapePts = nEscapes * 3;

    const totalInfractionPoints = skipPts + swallowPts + panicPts + escapePts;

    // Sub-linear volume normalization for ~3k LOC
    const kLocFactor = 1 + 1.2 * Math.log(3); // ~2.31
    const penalty = Math.round(totalInfractionPoints / kLocFactor);
    const score = Math.max(0, Math.min(100, 100 - penalty));

    scoreNum.textContent = score;
    penaltyEl.textContent = `-${penalty} pts`;

    // SVG Ring fill: circumference 2 * PI * 52 = 326.7
    const circumference = 326.7;
    const offset = circumference - (score / 100) * circumference;
    ringFill.style.strokeDashoffset = offset;

    // Ring Color
    if (score >= 85) {
      ringFill.style.stroke = "#10b981"; // green
    } else if (score >= 65) {
      ringFill.style.stroke = "#f59e0b"; // amber
    } else {
      ringFill.style.stroke = "#ef4444"; // red
    }

    // Determine Archetype
    let arch = "The Pragmatic Builder";
    let desc = "Disciplined engineering with clean commits and minimal shortcuts.";

    if (score >= 90) {
      if (totalInfractionPoints === 0) {
        arch = "The Clean Coder";
        desc = "Spotless discipline. No skipped tests, zero panic loops, and clean type safety.";
      } else {
        arch = "The Pragmatic Builder";
        desc = "Overwhelmingly disciplined. Only rare, isolated shortcuts across thousands of lines.";
      }
    } else {
      const maxPts = Math.max(skipPts, panicPts, escapePts, swallowPts);

      if (maxPts === panicPts && nPanics >= 2) {
        arch = "The Panic Looper";
        desc = "Prone to rapid-fire fix and revert thrashing cycles when wrestling stubborn bugs.";
      } else if (maxPts === skipPts && nSkips >= 2) {
        arch = "The Silent Vandal";
        desc = "When test suites push back, tends to disable or skip tests to keep pipelines green.";
      } else if (maxPts === escapePts && nEscapes >= 4) {
        arch = "The Any Architect";
        desc = "Leans on compiler bypasses (`as any`, `@ts-ignore`) rather than strict type modeling.";
      } else if (maxPts === swallowPts && nSwallow >= 1) {
        arch = "The Secret Keeper";
        desc = "Tends to silence errors with empty catch blocks, obscuring runtime failures.";
      } else if (score < 50) {
        arch = "The Chaos Gremlin";
        desc = "Mixes multiple shortcuts: skipped tests, type bypasses, and quick patches under pressure.";
      } else {
        arch = "The Shortcut Specialist";
        desc = "Frequently cuts corners on edge cases, prioritizing delivery speed over rigour.";
      }
    }

    titleEl.textContent = arch;
    descEl.textContent = desc;
  }

  [slSkips, slEscapes, slPanics, slSwallow].forEach((sl) => {
    sl.addEventListener("input", update);
  });

  update();
}
