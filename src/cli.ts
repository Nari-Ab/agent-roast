import { Command } from "commander";
import { readGit } from "./snapshot.js";
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import {
  roastRepository,
  checkProject,
  reviewChanges,
  reviewStagedChanges,
  reviewWorktreeChanges,
  replayHistory,
  runDemo,
  runHook,
  serveMcp,
  HOOK_AGENTS,
  AGENT_LABELS,
  installHooks,
  uninstallHooks,
  installInstructions,
  hookStatus,
  repositoryRoot,
  hookPausedUntil,
  pauseHook,
  resumeHook,
  parseDuration,
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
  gitOutputPath,
  formatGithubStepSummary,
  terminalText,
} from "./index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const errorMessage = (error: unknown): string => terminalText(error instanceof Error ? error.message : String(error));

/** Detectors that fail the run: none with --advisory, the --fail-on list, or undefined to leave it to the policy. */
function failOnOption(options: { failOn?: string; advisory?: boolean }): string[] | undefined {
  if (options.advisory) {
    if (options.failOn !== undefined) throw new ConfigError("--advisory cannot be combined with --fail-on.");
    return [];
  }
  return options.failOn?.split(",").map(rule => rule.trim()).filter(Boolean);
}

/** Shared CLI execution for committed and staged source comparison. */
async function runContextReview(repoPath: string, options: any, source: "commits" | "index" | "worktree"): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const common = { cwd: repoPath,
      failOn: failOnOption(options),
      ignoreExceptions: options.ignoreExceptions,
      format: options.json ? "json" : options.format, signal: controller.signal,
    };
    const result = source === "index" ? await reviewStagedChanges(common)
      : source === "worktree" ? await reviewWorktreeChanges(common)
      : await reviewChanges({ ...common, base: options.base, head: options.head });
    console.log(result.output);
    process.exitCode = result.exitCode;
    for (const [filename, content] of [
      [process.env.GITHUB_STEP_SUMMARY, formatReviewMarkdown(result) + "\n"],
      [process.env.GITHUB_OUTPUT, `passed=${result.passed}\ninfractions-count=${result.infractions.length}\nhas-supported-changes=${result.filesInspected > 0}\ncomplete=${result.complete}\nexisting-count=${result.unchangedCount}\nremoved-count=${result.removedFindings.length}\n`],
    ]) {
      if (!filename) continue;
      try { fs.appendFileSync(filename, content!); }
      catch (error) { console.error(`Warning: could not write an optional GitHub report artifact: ${errorMessage(error)}`); }
    }
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

/** No flag asks for the history score or a pull-request audit, so the bare command reviews today's work. */
function isDefaultInvocation(options: any): boolean {
  return !(options.all || options.base || options.staged || options.worktree || options.failUnder !== undefined || options.verbose || options.authors ||
    program.getOptionValueSource("since") === "cli" || program.getOptionValueSource("head") === "cli");
}

const NEXT_STEPS = [
  "",
  pc.bold("Next steps"),
  `  ${pc.cyan("npx agent-roast hook install")}   stop your coding agent from weakening checks (Claude Code, Codex, Cursor)`,
  `  ${pc.cyan("npx agent-roast init --ci")}      add the pull-request check (GitHub Actions)`,
  `  ${pc.cyan("npx agent-roast demo")}           see a scripted example`,
  "",
].join("\n");

/**
 * `agent-roast` with nothing else: review everything not committed yet against HEAD. When nothing is uncommitted, replay the
 * recent history instead, so a first run on a clean checkout still says something about the project.
 */
async function runDefault(repoPath: string, options: any): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const format = options.json ? "json" : options.format;
    if (!["terminal", "json", "github", "markdown", "sarif"].includes(format)) throw new ConfigError("--format must be terminal, json, github, markdown or sarif.");
    try { await readGit(path.resolve(repoPath), ["rev-parse", "--show-toplevel"], controller.signal, 8192); }
    catch (error) {
      if (!(error instanceof GitError)) throw error;
      console.error(`agent-roast reviews Git repositories, and ${terminalText(path.resolve(repoPath))} is not inside one.\nTo see what it does without one: npx agent-roast demo`);
      process.exitCode = 2;
      return;
    }
    const review = await reviewWorktreeChanges({ cwd: repoPath, failOn: failOnOption(options), ignoreExceptions: options.ignoreExceptions, format, signal: controller.signal });
    if (format === "terminal" && review.filesChanged === 0) {
      console.log(pc.dim("\nNothing is uncommitted. Here is what a pull-request check would have said about your recent commits:"));
      const progress = Boolean(process.stderr.isTTY);
      try {
        const replay = await replayHistory({
          cwd: repoPath, last: 50, format: "terminal", signal: controller.signal,
          onProgress: progress ? (done, total) => process.stderr.write(`\r  reviewed ${done}/${total} commits`) : undefined,
        });
        if (progress) process.stderr.write("\r\x1b[K");
        console.log(replay.summary.commits ? replay.output.replace(/\s+$/, "") : "\n  There is no earlier commit to compare with yet, so there is nothing to replay.");
        console.log(NEXT_STEPS);
        process.exitCode = replay.exitCode;
      } catch (error) {
        if (progress) process.stderr.write("\r\x1b[K");
        if (controller.signal.aborted) throw error;
        console.log(`\n  ${errorMessage(error)}\n  To see what agent-roast does: npx agent-roast demo\n`);
        process.exitCode = 0;
      }
      return;
    }
    console.log(review.output);
    process.exitCode = review.exitCode;
  } catch (error) {
    console.error(`agent-roast error: ${errorMessage(error)}`);
    process.exitCode = error instanceof ConfigError || error instanceof GitError || error instanceof GitResolutionError || error instanceof InvalidDetectorError ? 2 : 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

/** Agent names from the command line, validated. */
function parseAgents(names: string[]): (typeof HOOK_AGENTS)[number][] {
  return names.map(name => {
    if (!HOOK_AGENTS.includes(name.toLowerCase() as never)) throw new ConfigError(`Unknown agent '${name}'. Use ${HOOK_AGENTS.join(", ")}.`);
    return name.toLowerCase() as (typeof HOOK_AGENTS)[number];
  });
}

async function readStdin(timeoutMs = 5000): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

/** A path as the person would type it: relative to here when inside, `~` for the home directory otherwise. */
function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  const home = process.env.HOME || process.env.USERPROFILE;
  return home && file.startsWith(home) ? "~" + file.slice(home.length) : file;
}

const program = new Command();

program
  .name("agent-roast")
  .description("Check current code, review changes and audit Git history for coding shortcuts")
  .version(pkg.version || "0.4.0")
  .argument("[path]", "Path to git repository (default: current directory)", ".")
  .option("-a, --all", "Audit ALL commits regardless of AI attribution tags", false)
  .option("-s, --since <time>", "Time window for git analysis", "90 days ago")
  .option("-v, --verbose", "Show commit SHAs and line snippets for all infractions", false)
  .option("--json", "Output results as raw JSON", false)
  .option("--staged", "Compare full HEAD/index source and gate new staged findings (including the first commit)", false)
  .option("--worktree", "Compare HEAD with everything not committed yet: staged, unstaged and untracked files", false)
  .option("--base <ref>", "Base git ref/branch for PR mode audit (e.g. origin/main)")
  .option("--head <ref>", "Head git ref/SHA for PR mode audit (default: HEAD)", "HEAD")
  .option("--ignore-exceptions", "Report findings even when accepted by reviewed, unexpired exceptions", false)
  .option("--fail-on <rules>", "Comma-separated detectors that trigger CI failure")
  .option("--advisory", "Report findings without failing the run, the same as an empty --fail-on (setup errors and incomplete scans still fail)", false)
  .option("--fail-under <score>", "Fail CI if agent score is below threshold (0-100)")
  .option("--format <format>", "Output format: terminal, json, github, markdown (check/review also support sarif)", "terminal")
  .option("--authors", "Display author names and emails in report", false)
  .action((repoPath: string, options: any) => rootAction(repoPath, options));

/** The original behavior of the bare command: an audit of added lines in a pull request, or a score for the history. */
async function rootAction(repoPath: string, options: any): Promise<void> {
    try {
      if (!options.forceLegacy && isDefaultInvocation(options)) {
        await runDefault(repoPath, options);
        return;
      }
      if (options.worktree && (options.staged || options.base)) throw new ConfigError("--worktree compares HEAD with the working tree; --staged and --base do not apply.");
      if (options.worktree) {
        if (options.all || options.failUnder !== undefined || program.getOptionValueSource("since") === "cli" || program.getOptionValueSource("head") === "cli") {
          throw new ConfigError("--worktree compares HEAD and the working tree; --all, --since, --head and --fail-under do not apply.");
        }
        await runContextReview(repoPath, options, "worktree");
        return;
      }
      if (process.env.GITHUB_EVENT_NAME === "pull_request_target") {
        console.warn(
          "Warning: pull_request_target runs with elevated repository privileges. agent-roast recommends running on 'pull_request'."
        );
      }

      if (options.staged && options.base) throw new ConfigError("--staged cannot be combined with --base.");
      if (options.staged) {
        if (options.all || options.failUnder !== undefined || program.getOptionValueSource("since") === "cli" || program.getOptionValueSource("head") === "cli") {
          throw new ConfigError("--staged compares HEAD and index; --all, --since, --head and --fail-under do not apply.");
        }
        await runContextReview(repoPath, options, "index");
        return;
      }
      if (options.ignoreExceptions) throw new ConfigError("--ignore-exceptions applies to check, review and --staged context checks.");
      if (!["terminal", "json", "github", "markdown"].includes(options.format)) {
        throw new ConfigError("--format must be terminal, json, github, or markdown.");
      }
      if (options.failUnder !== undefined &&
          (options.failUnder.trim() === "" || !Number.isFinite(Number(options.failUnder)) || Number(options.failUnder) < 0 || Number(options.failUnder) > 100)) {
        throw new ConfigError("--fail-under must be a number between 0 and 100.");
      }
      if (!options.base && !options.staged && (options.failOn !== undefined || options.advisory)) {
        throw new ConfigError(`${options.advisory ? "--advisory" : "--fail-on"} requires --base or --staged.`);
      }
      if (!options.base && !options.staged && !options.json && !["terminal", "json"].includes(options.format)) {
        throw new ConfigError("Repository audits support terminal or json format; use --base or --staged for github/markdown.");
      }

      // Load repository config (.agentroastrc.json / agent-roast.config.json)
      const configRoot = gitOutputPath((await readGit(path.resolve(repoPath), ["rev-parse", "--show-toplevel"])).toString("utf8"));
      const config = loadConfig(configRoot);

      if (options.base || options.staged) {
        const failOnRules = failOnOption(options) ?? config.failOn;

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
            console.error(`Warning: Failed to write to GITHUB_STEP_SUMMARY: ${errorMessage(err)}`);
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
            console.error(`Warning: Failed to write to GITHUB_OUTPUT: ${errorMessage(err)}`);
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

        if (result.summary.skippedLongLines || result.summary.skippedUnknownFiles || result.summary.skippedBinaryFiles) {
          process.exitCode = 2;
        } else if (
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
        console.error(`agent-roast error: ${errorMessage(err)}`);
        process.exitCode = 2;
      } else {
        console.error(`Error auditing repository: ${errorMessage(err)}`);
        process.exitCode = 1;
      }
    }
}

program
  .command("review")
  .description("Compare full changed source at merge-base and head; gate only new findings")
  .argument("[path]", "Path to the Git repository", ".")
  .addHelpText("after", "\nRequired: --base <trusted-ref>  Optional: --head <ref> (default HEAD), or use --staged for HEAD/index, or --worktree for HEAD/everything uncommitted\nOutput: --format terminal|json|github|markdown|sarif, --json, --fail-on <rules>, --advisory\nExamples:\n  agent-roast review --base origin/main --format markdown\n  agent-roast review --worktree\n  agent-roast review --base HEAD~50 --advisory")
  .action(async (repoPath: string) => {
    try {
      const options = program.opts();
      if (options.worktree && options.staged) throw new ConfigError("--worktree and --staged cannot be combined.");
      if (options.staged || options.worktree ? options.base || program.getOptionValueSource("head") === "cli" : !options.base) {
        throw new ConfigError("Use review --base <trusted-ref>, review --staged or review --worktree; --base/--head cannot be combined with --staged or --worktree.");
      }
      if (options.all || options.failUnder !== undefined || program.getOptionValueSource("since") === "cli") {
        throw new ConfigError("review compares source snapshots; --all, --since and --fail-under do not apply.");
      }
      await runContextReview(repoPath, options, options.staged ? "index" : options.worktree ? "worktree" : "commits");
    } catch (error) {
      console.error(`agent-roast review error: ${errorMessage(error)}`);
      process.exitCode = 2;
    }
  });

program
  .command("replay")
  .description("Review each of the newest commits on its own, to see what a pull-request check would have said")
  .argument("[path]", "Path to the Git repository", ".")
  .option("--last <n>", "How many of the newest commits to review (default 50, at most 1000)")
  .option("--all-rules", "List line-pattern warnings (type-escape, swallowed-error, stub-abandonment) as well", false)
  .addHelpText("after", "\nOutput: --format terminal|json, --json\nExamples:\n  agent-roast replay\n  agent-roast replay --last 200 --json")
  .action(async (repoPath: string, opts: { last?: string; allRules?: boolean }) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const global = program.opts();
      if (global.base || global.staged || global.worktree || global.failOn !== undefined || global.advisory || global.failUnder !== undefined || global.all || global.ignoreExceptions ||
          program.getOptionValueSource("head") === "cli" || program.getOptionValueSource("since") === "cli") {
        throw new ConfigError("replay reviews each commit on its own; --base, --head, --staged, --worktree, --fail-on, --advisory, --fail-under, --all, --since and --ignore-exceptions do not apply.");
      }
      const format = global.json ? "json" : global.format;
      if (format !== "terminal" && format !== "json") throw new ConfigError("replay supports --format terminal or json.");
      const last = opts.last === undefined ? 50 : Number(opts.last);
      if (!/^\d+$/.test(opts.last ?? "50") || last < 1 || last > 1000) throw new ConfigError("--last must be a whole number between 1 and 1000.");
      const progress = process.stderr.isTTY && format === "terminal";
      const result = await replayHistory({
        cwd: repoPath, last, allRules: opts.allRules, format, signal: controller.signal,
        onProgress: progress ? (done, total) => process.stderr.write(`\r  reviewed ${done}/${total} commits`) : undefined,
      });
      if (progress) process.stderr.write("\r\x1b[K");
      console.log(result.output);
      process.exitCode = result.exitCode;
    } catch (error) {
      console.error(`agent-roast replay error: ${errorMessage(error)}`);
      process.exitCode = 2;
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  });

program
  .command("check")
  .description("Check current tracked and non-ignored untracked source files")
  .argument("[path]", "Path to a git repository", ".")
  .option("--baseline <file>", "Report only findings not accepted in this baseline")
  .option("--write-baseline <file>", "Save current findings for adoption (refuses to overwrite)")
  .addHelpText("after", "\nOutput options: --format terminal|json|github|markdown|sarif, --json, --fail-on <rules>, --advisory\nExamples:\n  agent-roast check\n  agent-roast check --write-baseline .agentroast-baseline.json\n  agent-roast check --baseline .agentroast-baseline.json --format json")
  .action(async (repoPath: string, opts: { baseline?: string; writeBaseline?: string }) => {
    try {
      const global = program.opts();
      if (global.base || global.staged || global.worktree || global.failUnder !== undefined || global.all ||
          program.getOptionValueSource("head") === "cli" || program.getOptionValueSource("since") === "cli") {
        throw new ConfigError("check inspects current files; history, --base, --head, --staged, --worktree and --fail-under options do not apply.");
      }
      if (opts.baseline && opts.writeBaseline) throw new ConfigError("--baseline and --write-baseline cannot be combined.");
      const result = await checkProject({
        cwd: repoPath,
        baseline: opts.baseline,
        ignoreExceptions: global.ignoreExceptions,
        failOn: failOnOption(global),
        format: global.json ? "json" : global.format,
      });
      if (opts.writeBaseline) {
        if (!result.complete) throw new ConfigError("Cannot create a baseline from an incomplete scan. Resolve skipped files first.");
        const basePath = path.resolve(repoPath, opts.writeBaseline);
        writeBaseline(basePath, result.infractions);
        const message = `Baseline created: ${basePath}\nAccepted ${result.infractions.length} existing findings. The code has not been fixed.\nReview and commit the baseline, then run check --baseline <file> to catch new findings.`;
        console.log(global.json || global.format === "json" ? JSON.stringify({ operation: "write-baseline", baseline: basePath, acceptedFindings: result.infractions.length }, null, 2) : message);
        process.exitCode = 0;
        return;
      }
      console.log(result.output);
      process.exitCode = result.exitCode;
    } catch (err: unknown) {
      console.error(`agent-roast check error: ${errorMessage(err)}`);
      process.exitCode = 2;
    }
  });

program
  .command("explain <rule>")
  .description("Explain a detector, its limits, and how to address a finding")
  .action((rule: string) => {
    if (program.opts().ignoreExceptions) {
      console.error("--ignore-exceptions applies to check, review and --staged context checks."); process.exitCode = 2; return;
    }
    if (!VALID_DETECTORS.includes(rule as import("./types.js").DetectorType)) {
      console.error(`Unknown rule '${terminalText(rule)}'. Valid rules: ${VALID_DETECTORS.join(", ")}`);
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
      if (program.opts().ignoreExceptions) throw new ConfigError("--ignore-exceptions applies to check, review and --staged context checks.");
      const res = await initProject({
        cwd: targetDir,
        yes: opts.yes,
        ci: opts.ci,
        hook: opts.hook,
      });

      if (res.created.length > 0) {
        console.log(`Initialized agent-roast in ${terminalText(res.directory)}:`);
        for (const file of res.created) {
          console.log(`  + Created ${terminalText(file)}`);
        }
      }

      if (res.skipped.length > 0) {
        for (const file of res.skipped) {
          console.log(`  - Skipped ${terminalText(file)} (already exists or not applicable)`);
        }
      }

      if (res.created.length === 0 && res.skipped.length === 0) {
        console.log("No files were created.");
      }
    } catch (err: any) {
      console.error(`Failed to initialize agent-roast: ${errorMessage(err)}`);
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
  .action(async (repoPath: string, opts: any, command: Command) => {
    try {
      const rootOpts = program.opts();
      const isJson = Boolean(opts.json || rootOpts.json);
      const isAll = Boolean(opts.all || rootOpts.all);
      if (rootOpts.ignoreExceptions) throw new ConfigError("--ignore-exceptions applies to check, review and --staged context checks.");
      const since = command.getOptionValueSource("since") === "cli" ? opts.since : rootOpts.since || "90 days ago";

      const configRoot = gitOutputPath((await readGit(path.resolve(repoPath), ["rev-parse", "--show-toplevel"])).toString("utf8"));
      const config = loadConfig(configRoot);
      const result = await roastRepository({
        cwd: repoPath,
        since,
        all: isAll,
        ignorePaths: config.ignorePaths,
        rules: config.rules,
        panicLoopWindowMinutes: config.panicLoopWindowMinutes,
      });

      if (result.summary.skippedLongLines || result.summary.skippedUnknownFiles || result.summary.skippedBinaryFiles) throw new ConfigError("Cannot generate a badge from an incomplete historical audit; resolve skipped source first.");
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
        console.log(`Generated SVG badge at: ${terminalText(opts.out)}`);
        process.exitCode = 0;
        return;
      }

      // Default: print Markdown badge
      const markdown = generateShieldsMarkdown(score, label);
      console.log(`\nBadge for README.md:\n\n${markdown}\n`);
      process.exitCode = 0;
    } catch (err: any) {
      console.error(`Error generating badge: ${errorMessage(err)}`);
      process.exitCode = err instanceof ConfigError || err instanceof GitError || err instanceof GitResolutionError ? 2 : 1;
    }
  });

program
  .command("demo")
  .description("See what agent-roast reports for a scripted \"fix\" that weakens the checks (a temporary repository; nothing of yours is read)")
  .action(async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      if (program.opts().worktree || program.opts().staged || program.opts().base) throw new ConfigError("demo takes no review options.");
      const demo = await runDemo({ signal: controller.signal });
      console.log(demo.output);
      process.exitCode = demo.exitCode;
    } catch (error) {
      console.error(`agent-roast demo error: ${errorMessage(error)}`);
      process.exitCode = 2;
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  });

program
  .command("audit")
  .description("Score the Git history by the shortcuts it adds (the original agent-roast report)")
  .argument("[path]", "Path to git repository (default: current directory)", ".")
  .action((repoPath: string) => rootAction(repoPath, { ...program.opts(), forceLegacy: true }));

const hook = program
  .command("hook")
  .description("Guard a coding agent: send it back to fix the code when it weakens a check (Claude Code, Codex, Cursor)");

hook
  .command("run")
  .description("Run by the agent when it is about to finish; reads the agent's JSON on stdin and answers in its dialect")
  .option("--agent <agent>", `${HOOK_AGENTS.join(", ")} (detected from the input when omitted)`)
  .action(async (opts: { agent?: string }) => {
    // Exit status 2 tells an agent to block, so only a misspelled --agent (a setup mistake) is non-zero.
    let agent: (typeof HOOK_AGENTS)[number] | undefined;
    try { agent = opts.agent === undefined ? undefined : parseAgents([opts.agent])[0]; }
    catch (error) { console.error(`agent-roast hook: ${errorMessage(error)}`); process.exitCode = 1; return; }
    try {
      const outcome = await runHook(await readStdin(), { agent });
      if (outcome.stdout) process.stdout.write(outcome.stdout);
      if (outcome.stderr) process.stderr.write(outcome.stderr);
      process.exitCode = outcome.exitCode;
    } catch (error) {
      // The agent must never be blocked by a problem in this tool.
      console.error(`agent-roast hook: ${errorMessage(error)}`);
      process.exitCode = 0;
    }
  });

hook
  .command("install")
  .description("Add the hook to Claude Code, Codex or Cursor in this repository")
  .argument("[agents...]", `${HOOK_AGENTS.join(", ")} (default: the agents that already have a folder in this repository)`)
  .option("--global", "install for every repository of this user instead", false)
  .option("--local", "Claude Code only: use .claude/settings.local.json, which stays out of Git", false)
  .option("--command <program>", "program to run instead of 'npx --yes agent-roast@<version>', for example 'agent-roast' when installed globally")
  .option("--instructions", "also write a short 'keep the checks honest' paragraph into AGENTS.md / CLAUDE.md", false)
  .option("--dry-run", "show what would change without writing anything", false)
  .action((names: string[], opts: { global: boolean; local: boolean; command?: string; instructions: boolean; dryRun: boolean }) => {
    try {
      if (opts.global && opts.local) throw new ConfigError("Choose --global or --local, not both.");
      let agents = parseAgents(names);
      const root = repositoryRoot(process.cwd());
      if (!agents.length) agents = HOOK_AGENTS.filter(agent => fs.existsSync(path.join(root, { claude: ".claude", codex: ".codex", cursor: ".cursor" }[agent])));
      if (!agents.length) throw new ConfigError("Name the agent to guard: agent-roast hook install claude (or codex, cursor).");
      const scope = opts.global ? "global" : opts.local ? "local" : "project";
      const changes = installHooks({ cwd: process.cwd(), agents, scope, command: opts.command, dryRun: opts.dryRun });
      console.log(`${opts.dryRun ? "Would install" : "Installed"} the agent-roast hook (${scope}):`);
      for (const change of changes) console.log(`  ${change.action === "unchanged" ? "=" : "+"} ${AGENT_LABELS[change.agent]}: ${displayPath(change.file)} (${change.action})\n      ${change.command}`);
      if (opts.instructions) {
        for (const change of installInstructions({ cwd: process.cwd(), dryRun: opts.dryRun })) console.log(`  + ${displayPath(change.file)} (${change.action}): keep-the-checks-honest paragraph`);
      }
      if (agents.includes("codex")) console.log("\nCodex runs a new hook only after you trust it: open Codex and review it with /hooks.");
      if (!opts.dryRun) console.log("\nWhen the agent is about to finish with weakened checks it is sent back once to fix the code.\nTurn it off for a while: agent-roast hook pause   ·   remove it: agent-roast hook uninstall");
    } catch (error) {
      console.error(`agent-roast hook install error: ${errorMessage(error)}`);
      process.exitCode = 2;
    }
  });

hook
  .command("uninstall")
  .description("Remove the hook from Claude Code, Codex or Cursor")
  .argument("[agents...]", `${HOOK_AGENTS.join(", ")} (default: all)`)
  .option("--global", "remove it from the user-level files", false)
  .option("--local", "Claude Code only: remove it from .claude/settings.local.json", false)
  .option("--dry-run", "show what would change without writing anything", false)
  .action((names: string[], opts: { global: boolean; local: boolean; dryRun: boolean }) => {
    try {
      if (opts.global && opts.local) throw new ConfigError("Choose --global or --local, not both.");
      const agents = names.length ? parseAgents(names) : [...HOOK_AGENTS].filter(agent => !(opts.local && agent !== "claude"));
      const scope = opts.global ? "global" : opts.local ? "local" : "project";
      for (const change of uninstallHooks({ cwd: process.cwd(), agents, scope, dryRun: opts.dryRun })) {
        console.log(`  ${change.action === "removed" ? "-" : "="} ${AGENT_LABELS[change.agent]}: ${displayPath(change.file)} (${change.action === "removed" ? (opts.dryRun ? "would be removed" : "removed") : "no agent-roast hook there"})`);
      }
    } catch (error) {
      console.error(`agent-roast hook uninstall error: ${errorMessage(error)}`);
      process.exitCode = 2;
    }
  });

hook
  .command("status")
  .description("Show where the hook is installed")
  .action(async () => {
    try {
      const rows = hookStatus({ cwd: process.cwd() });
      for (const row of rows) console.log(`  ${row.installed ? pc.green("installed") : pc.dim("not set  ")}  ${AGENT_LABELS[row.agent].padEnd(11)} ${row.scope.padEnd(8)} ${displayPath(row.file)}`);
      const paused = await hookPausedUntil(process.cwd());
      if (paused) console.log(`\n  Paused in this repository until ${paused.toLocaleString()} (agent-roast hook resume).`);
      if (!rows.some(row => row.installed)) console.log("\n  Install it with: agent-roast hook install claude   (or codex, cursor)");
    } catch (error) {
      console.error(`agent-roast hook status error: ${errorMessage(error)}`);
      process.exitCode = 2;
    }
  });

hook
  .command("pause")
  .description("Let the agent finish without the check in this repository for a while (for a change you have approved)")
  .option("--for <duration>", "how long: 30m, 2h, 1d", "4h")
  .action(async (opts: { for: string }) => {
    try {
      const until = new Date(Date.now() + parseDuration(opts.for));
      await pauseHook(process.cwd(), until);
      console.log(`The hook is paused in this repository until ${until.toLocaleString()}. Resume now: agent-roast hook resume`);
    } catch (error) {
      console.error(`agent-roast hook pause error: ${errorMessage(error)}`);
      process.exitCode = 2;
    }
  });

hook
  .command("resume")
  .description("End a pause")
  .action(async () => {
    try {
      console.log(await resumeHook(process.cwd()) ? "The hook is active again." : "The hook was not paused.");
    } catch (error) {
      console.error(`agent-roast hook resume error: ${errorMessage(error)}`);
      process.exitCode = 2;
    }
  });

program
  .command("mcp")
  .description("Run as an MCP server over stdio, so any MCP-capable coding agent can review its own changes (read-only, offline)")
  .option("--root <directory...>", "a directory the tools may review (repeatable); defaults to the project the server was started in")
  .action(async (opts: { root?: string[] }) => {
    try {
      await serveMcp({ version: pkg.version, roots: opts.root });
    } catch (error) {
      console.error(`agent-roast mcp: ${errorMessage(error)}`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);

