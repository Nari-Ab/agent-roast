# Design Specification: agent-roast v0.4.0 ("Viral Growth & PR Visibility")

## 1. Objectives
1. **Provide a zero-dependency Badge Generator (`agent-roast badge`)**:
   - Generate standalone dynamic SVG badges for repositories.
   - Generate Shields.io-compatible Markdown badges and JSON endpoint schemas.
   - Give developers an immediate incentive to showcase their high AI discipline score in `README.md`.
2. **Enhanced PR Markdown Comment Formatter**:
   - Provide `formatPrMarkdownComment` that outputs a rich, GitHub-optimized table with expandable `<details>` blocks for PR reviews.
   - Support `--format markdown` in CLI and action outputs.
3. **Distribution Asset**:
   - Ready-to-publish long-form technical article for Dev.to / Medium / Habr demonstrating real-world AI coding agent cheats and how `agent-roast` detects them offline.

## 2. Architecture & Interfaces

### Badge Generator (`src/badge.ts`)
```ts
export interface BadgeOptions {
  label?: string;
  score: number | null;
  outPath?: string;
  json?: boolean;
}

export interface ShieldsEndpointResponse {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  style?: string;
}

export function getScoreColor(score: number | null): { name: string; hex: string };
export function generateSvgBadge(score: number | null, label?: string): string;
export function generateShieldsMarkdown(score: number | null, label?: string): string;
export function generateShieldsJson(score: number | null, label?: string): ShieldsEndpointResponse;
```

### PR Markdown Formatter (`src/renderer.ts`)
- `formatPrMarkdownComment(result: PrAuditResult): string`
  - Compact markdown table showing Pass/Fail, defect density, files inspected, lines added.
  - Collapsible list of infractions with code snippets and filenames.
  - Clean footer: `Audited 100% offline with [agent-roast](https://github.com/Nari-Ab/agent-roast)`.

### CLI Integration (`src/cli.ts`)
- New command `badge`:
  ```bash
  agent-roast badge [path] [--out <file>] [--json]
  ```
- Support `--format markdown` for PR audits:
  ```bash
  agent-roast --base origin/main --format markdown
  ```

## 3. Backward Compatibility & Quality
- Zero new external runtime dependencies (`commander` and `picocolors` remain the only dependencies).
- 100% offline, pure Node.js string templating for SVG.
- Complete unit and integration test coverage.
