import { Command } from "commander";
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import {
  roastRepository,
  checkProject,
  reviewChanges,
  formatReviewMarkdown,
  writeBaseline,
  RULE_GUIDES,
  VALID_DETECTORS,
  auditPullRequest,
  loadConfig,
  initProject,
  generateSvgBadge,
  generateShieldsMarkdown,
  generateShieldsJson,
  GitResolutionError,
  InvalidDetectorError,
  GitError,
  ConfigError,
  formatGithubStepSummary,
} from "./index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("agent-roast")
  .description("Audit your git history or PR diffs for AI coding shortcuts and panic loops")
  .version(pkg.version || "0.4.0")
  .argument("[path]", "Path to git repository (default: current directory)", ".")
  .option("-a, --all", "Audit ALL commits regardless of AI attribution tags", false)
  .option("-s, --since <time>", "Time window for git analysis", "90 days ago")
  .option("-v, --verbose", "Show commit SHAs and line snippets for all infractions", false)
  .option("--json", "Output results as raw JSON", false)
  .option("--staged", "Audit staged changes before committing (including the first commit)", false)
  .option("--base <ref>", "Base git ref/branch for PR mode audit (e.g. origin/main)")
  .option("--head <ref>", "Head git ref/SHA for PR mode audit (default: HEAD)", "HEAD")
  .option("--fail-on <rules>", "Comma-separated detectors that trigger CI failure")
  .option("--fail-under <score>", "Fail CI if agent score is below threshold (0-100)")
  .option("--format <format>", "Output format: terminal, json, github, markdown (check/review also support sarif)", "terminal")
  .option("--authors", "Display author names and emails in report", false)
  .action(async (repoPath: string, options: any) => {
    try {
      if (process.env.GITHUB_EVENT_NAME === "pull_request_target") {
        console.warn(
          "Warning: pull_request_target runs with elevated repository privileges. agent-roast recommends running on 'pull_request'."
        );
      }

      if (options.staged && options.base) throw new ConfigError("--staged cannot be combined with --base.");
      if (!["terminal", "json", "github", "markdown"].includes(options.format)) {
        throw new ConfigError("--format must be terminal, json, github, or markdown.");
      }
      if (options.failUnder !== undefined &&
          (options.failUnder.trim() === "" || !Number.isFinite(Number(options.failUnder)) || Number(options.failUnder) < 0 || Number(options.failUnder) > 100)) {
        throw new ConfigError("--fail-under must be a number between 0 and 100.");
      }
      if (!options.base && !options.staged && options.failOn !== undefined) {
        throw new ConfigError("--fail-on requires --base or --staged.");
      }
      if (!options.base && !options.staged && !options.json && !["terminal", "json"].includes(options.format)) {
        throw new ConfigError("Repository audits support terminal or json format; use --base or --staged for github/markdown.");
      }

      // Load repository config (.agentroastrc.json / agent-roast.config.json)
      const config = await loadConfig(repoPath);

      if (options.base || options.staged) {
        const failOnRules = options.failOn !== undefined
          ? options.failOn.split(",").map((s: string) => s.trim()).filter(Boolean)
          : config.failOn;

        const chosenFormat = options.json ? "json" : options.format || "terminal";

        const prResult = await auditPullRequest({
          cwd: repoPath,
          base: options.base,
          staged: options.staged,
          head: options.head || "HEAD",
          failOn: failOnRules,
          format: chosenFormat,
          verbose: options.verbose,
          authors: options.authors,
          ignorePaths: config.ignorePaths,
          rules: config.rules,
        });

        // Write GitHub Step Summary if running in GitHub Actions
        if (process.env.GITHUB_STEP_SUMMARY) {
          try {
            fs.appendFileSync(
              process.env.GITHUB_STEP_SUMMARY,
              formatGithubStepSummary(prResult) + "\n"
            );
          } catch (err: any) {
            console.error(`Warning: Failed to write to GITHUB_STEP_SUMMARY: ${err.message}`);
          }
        }

        // Write GitHub step outputs
        if (process.env.GITHUB_OUTPUT) {
          try {
            fs.appendFileSync(
              process.env.GITHUB_OUTPUT,
              `passed=${prResult.passed}\ninfractions-count=${prResult.infractions.length}\nhas-supported-changes=${prResult.hasSupportedChanges}\n`
            );
          } catch (err: any) {
            console.error(`Warning: Failed to write to GITHUB_OUTPUT: ${err.message}`);
          }
        }

        console.log(prResult.output);
        process.exitCode = prResult.exitCode;
      } else {
        // Full Repo Audit Mode
        const result = await roastRepository({
          cwd: repoPath,
          since: options.since,
          all: options.all,
          verbose: options.verbose,
          json: options.json,
          panicLoopWindowMinutes: config.panicLoopWindowMinutes,
          ignorePaths: config.ignorePaths,
          rules: config.rules,
        });

        if (options.json || options.format === "json") {
          console.log(JSON.stringify(result.summary, null, 2));
        } else {
          console.log(result.output);
        }

        const scoreThreshold = options.failUnder !== undefined
          ? Number(options.failUnder)
          : config.scoreThreshold;

        if (
          scoreThreshold !== undefined &&
          !isNaN(scoreThreshold) &&
          result.summary.score !== null &&
          result.summary.score < scoreThreshold
        ) {
          process.exitCode = 1;
        } else {
          process.exitCode = 0;
        }
      }
    } catch (err: any) {
      if (
        err instanceof ConfigError ||
        err instanceof GitResolutionError ||
        err instanceof InvalidDetectorError ||
        err instanceof GitError ||
        err.name === "GitError"
      ) {
        console.error(`agent-roast error: ${err.message}`);
        process.exitCode = 2;
      } else {
        console.error(`Error auditing repository: ${err.message}`);
        process.exitCode = 1;
      }
    }
  });

program
  .command("review")
  .description("Compare full changed source at merge-base and head; gate only new findings")
  .argument("[path]", "Path to the Git repository", ".")
  .addHelpText("after", "\nRequired: --base <trusted-ref>  Optional: --head <ref> (default HEAD)\nOutput: --format terminal|json|github|markdown|sarif, --json, --fail-on <rules>\nExample: agent-roast review --base origin/main --format markdown")
  .action(async (repoPath: string) => {
    try {
      const options = program.opts();
      if (!options.base) throw new ConfigError("review requires --base <trusted-ref>.");
      if (options.staged || options.all || options.failUnder !== undefined || program.getOptionValueSource("since") === "cli") {
        throw new ConfigError("review compares committed refs; --staged, --all, --since and --fail-under do not apply.");
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.once("SIGINT", abort);
      process.once("SIGTERM", abort);
      try {
        const result = await reviewChanges({ cwd: repoPath, base: options.base, head: options.head,
          failOn: options.failOn !== undefined ? options.failOn.split(",").map((rule: string) => rule.trim()).filter(Boolean) : undefined,
          format: options.json ? "json" : options.format, signal: controller.signal,
        });
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatReviewMarkdown(result) + "\n");
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
          `passed=${result.passed}\ninfractions-count=${result.infractions.length}\nhas-supported-changes=${result.filesInspected > 0}\ncomplete=${result.complete}\nexisting-count=${result.unchangedCount}\nremoved-count=${result.removedFindings.length}\n`);
        console.log(result.output);
        process.exitCode = result.exitCode;
      } finally {
        process.removeListener("SIGINT", abort);
        process.removeListener("SIGTERM", abort);
      }
    } catch (error) {
      console.error(`agent-roast review error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

program
  .command("check")
  .description("Check current tracked and non-ignored untracked source files")
  .argument("[path]", "Path to a git repository", ".")
  .option("--baseline <file>", "Report only findings not accepted in this baseline")
  .option("--write-baseline <file>", "Save current findings for adoption (refuses to overwrite)")
  .addHelpText("after", "\nOutput options: --format terminal|json|github|markdown|sarif, --json, --fail-on <rules>\nExamples:\n  agent-roast check\n  agent-roast check --write-baseline .agentroast-baseline.json\n  agent-roast check --baseline .agentroast-baseline.json --format json")
  .action(async (repoPath: string, opts: { baseline?: string; writeBaseline?: string }) => {
    try {
      const global = program.opts();
      if (global.base || global.staged || global.failUnder !== undefined || global.all ||
          program.getOptionValueSource("head") === "cli" || program.getOptionValueSource("since") === "cli") {
        throw new ConfigError("check inspects current files; history, --base, --head, --staged and --fail-under options do not apply.");
      }
      if (opts.baseline && opts.writeBaseline) throw new ConfigError("--baseline and --write-baseline cannot be combined.");
      const result = await checkProject({
        cwd: repoPath,
        baseline: opts.baseline,
        failOn: global.failOn !== undefined ? global.failOn.split(",").map((rule: string) => rule.trim()).filter(Boolean) : undefined,
        format: global.json ? "json" : global.format,
      });
      if (opts.writeBaseline) {
        if (!result.complete) throw new ConfigError("Cannot create a baseline from an incomplete scan. Resolve skipped files first.");
        const basePath = path.resolve(repoPath, opts.writeBaseline);
        writeBaseline(basePath, result.infractions);
        const message = `Baseline created: ${basePath}\nAccepted ${result.totalFindings} existing findings. The code has not been fixed.\nReview and commit the baseline, then run check --baseline <file> to catch new findings.`;
        console.log(global.json || global.format === "json" ? JSON.stringify({ operation: "write-baseline", baseline: basePath, acceptedFindings: result.totalFindings }, null, 2) : message);
        process.exitCode = 0;
        return;
      }
      console.log(result.output);
      process.exitCode = result.exitCode;
    } catch (err: unknown) {
      console.error(`agent-roast check error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
    }
  });

program
  .command("explain <rule>")
  .description("Explain a detector, its limits, and how to address a finding")
  .action((rule: string) => {
    if (!VALID_DETECTORS.includes(rule as import("./types.js").DetectorType)) {
      console.error(`Unknown rule '${rule}'. Valid rules: ${VALID_DETECTORS.join(", ")}`);
      process.exitCode = 2;
      return;
    }
    const guide = RULE_GUIDES[rule as import("./types.js").DetectorType];
    console.log(`${rule}: ${guide.title}\n\nWhy: ${guide.why}\n\nNext: ${guide.suggestion}\n\nExample: ${guide.example}\n`);
  });

program
  .command("init")
  .description("Initialize .agentroastrc.json and CI/hook configurations")
  .argument("[dir]", "Directory to initialize", ".")
  .option("-y, --yes", "Skip interactive prompts and use defaults", false)
  .option("--ci", "Generate GitHub Actions workflow file", false)
  .option("--hook", "Install Git pre-commit hook", false)
  .action(async (targetDir: string, opts: any) => {
    try {
      const res = await initProject({
        cwd: targetDir,
        yes: opts.yes,
        ci: opts.ci,
        hook: opts.hook,
      });

      if (res.created.length > 0) {
        console.log(`Initialized agent-roast in ${targetDir}:`);
        for (const file of res.created) {
          console.log(`  + Created ${file}`);
        }
      }

      if (res.skipped.length > 0) {
        for (const file of res.skipped) {
          console.log(`  - Skipped ${file} (already exists or not applicable)`);
        }
      }

      if (res.created.length === 0 && res.skipped.length === 0) {
        console.log("No files were created.");
      }
    } catch (err: any) {
      console.error(`Failed to initialize agent-roast: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("badge")
  .description("Generate an AI discipline badge (SVG, Markdown, or Shields JSON)")
  .argument("[path]", "Path to git repository (default: current directory)", ".")
  .option("-a, --all", "Audit ALL commits regardless of AI attribution tags", false)
  .option("-s, --since <time>", "Time window for git analysis", "90 days ago")
  .option("--label <text>", "Badge label text", "AI Discipline")
  .option("--out <file>", "Output SVG file path (e.g. ./badge.svg)")
  .action(async (repoPath: string, opts: any) => {
    try {
      const rootOpts = program.opts();
      const isJson = Boolean(opts.json || rootOpts.json);
      const isAll = Boolean(opts.all || rootOpts.all);
      const since = opts.since || rootOpts.since || "90 days ago";

      const config = await loadConfig(repoPath);
      const result = await roastRepository({
        cwd: repoPath,
        since,
        all: isAll,
        ignorePaths: config.ignorePaths,
        rules: config.rules,
        panicLoopWindowMinutes: config.panicLoopWindowMinutes,
      });

      const score = result.summary.score;
      const label = opts.label || "AI Discipline";

      if (isJson) {
        const payload = generateShieldsJson(score, label);
        console.log(JSON.stringify(payload, null, 2));
        process.exitCode = 0;
        return;
      }

      if (opts.out) {
        const svg = generateSvgBadge(score, label);
        const outPath = path.resolve(opts.out);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, svg, "utf-8");
        console.log(`Generated SVG badge at: ${opts.out}`);
        process.exitCode = 0;
        return;
      }

      // Default: print Markdown badge
      const markdown = generateShieldsMarkdown(score, label);
      console.log(`\nBadge for README.md:\n\n${markdown}\n`);
      process.exitCode = 0;
    } catch (err: any) {
      console.error(`Error generating badge: ${err.message}`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);

