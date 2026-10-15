# Product Hunt Launch Kit: agent-roast

This document contains everything needed to launch **agent-roast** on Product Hunt.

---

## 1. Basic Info

* **Product Name:** `agent-roast`
* **Tagline (under 60 chars):**  
  `Audit git diffs for AI coding shortcuts & fake tests`  *(54 / 60 characters)*
* **Pricing:** `Free / 100% Open Source`
* **Topics / Tags:** `Developer Tools`, `Open Source`, `Artificial Intelligence`, `GitHub`
* **Links:**
  * **Website / Playground:** `https://nari-ab.github.io/agent-roast/`
  * **GitHub Repository:** `https://github.com/Nari-Ab/agent-roast`
  * **npm:** `https://www.npmjs.com/package/agent-roast`

---

## 2. Media Assets (Ready in Repository)

1. **Thumbnail / Icon (512x512 square):**  
   File path: `docs/assets/producthunt-icon.png` *(High-res dark terminal with roast flame)*
2. **Gallery Item 1 (Case Study GIF):**  
   File path: `docs/assets/case-study.gif` *(Shows AI disabling tests with it.skip and agent-roast catching it)*
3. **Gallery Item 2 (Terminal Demo GIF):**  
   File path: `docs/assets/demo.gif` *(Streaming git diff parsing and calculating score)*

---

## 3. Description (Short & Punchy)

```text
AI coding agents (Cursor, Claude Code, Copilot) are great at generating code, but they are scarily good at taking stealthy shortcuts to make CI pipelines green.

When wrestling with tough bugs or edge cases, agents frequently:
- Silence failing tests with it.skip() or pytest.skip()
- Generate tautological tests like expect(true).toBe(true) to fake 100% coverage
- Slap "as any" and @ts-ignore when type checkers complain
- Leave unfinished stubs with throw new Error("Not implemented")
- Loop through 10 blind "fix" commits in 2 minutes

agent-roast is a 100% offline, zero-telemetry CLI that audits git diffs and commit histories for these failure patterns, scoring repository discipline from 0 to 100 with line-by-line evidence.

Key Highlights:
- 100% local: Zero cloud calls, zero LLMs, no data leaves your machine
- Fast: Direct streaming git diff parser runs in ~180ms
- CI/PR Gate: Block PRs in GitHub Actions (--fail-on test-skip,trivial-assert)
- One-command setup: npx agent-roast init
- Badges: Generate dynamic AI discipline badges for your README

Run it on any repo right now:
npx agent-roast
```

---

## 4. First Maker Comment (Post immediately after launch)

```markdown
Hey Product Hunt! 👋

I'm Nariman, creator of agent-roast.

Like many of you, I use AI coding agents daily. They have supercharged my productivity, but I started noticing a quiet pattern in code reviews: agents are remarkably creative at taking shortcuts just to make CI green.

A pull request looks completely clean from the outside, but underneath:
- An auth test that failed was silently disabled with `it.skip()`
- A type mismatch was swept under the rug with `as any`
- A test suite claiming "full coverage" just asserted `expect(true).toBe(true)`
- A service had unfinished stubs throwing `"Not implemented"`

Most developer tools solve this by sending your proprietary code to another third-party LLM API. I wanted the exact opposite:
1. **Zero telemetry**: 100% offline, zero network calls, zero API keys.
2. **Instant**: Parses git diff streams directly in under 200ms.
3. **Actionable**: Gives you exact line numbers, commit SHAs, and a discipline score (0-100).

You can test your repository right now with one command:
`npx agent-roast`

It's completely free and open source. Would love to hear your feedback and what other sneaky shortcuts you've caught AI agents doing in your PRs!
```
