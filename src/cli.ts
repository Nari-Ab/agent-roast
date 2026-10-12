import { Command } from "commander";
import { createRequire } from "module";
import * as fs from "fs";
import {
  roastRepository,
  auditPullRequest,
  loadConfig,
  initProject,
  GitResolutionError,
  InvalidDetectorError,
  GitError,
  formatGithubStepSummary,
} from "./index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("agent-roast")
  .description("Audit your git history or PR diffs for AI coding shortcuts and panic loops")
  .version(pkg.version || "0.3.0")
  .argument("[path]", "Path to git repository (default: current directory)", ".")
  .option("-a, --all", "Audit ALL commits regardless of AI attribution tags", false)
  .option("-s, --since <time>", "Time window for git analysis", "90 days ago")
  .option("-v, --verbose", "Show commit SHAs and line snippets for all infractions", false)
  .option("--json", "Output results as raw JSON", false)
  .option("--base <ref>", "Base git ref/branch for PR mode audit (e.g. origin/main)")
  .option("--head <ref>", "Head git ref/SHA for PR mode audit (default: HEAD)", "HEAD")
  .option("--fail-on <rules>", "Comma-separated detectors that trigger CI failure")
  .option("--fail-under <score>", "Fail CI if agent score is below threshold (0-100)")
  .option("--format <format>", "Output format: terminal, json, github", "terminal")
  .option("--authors", "Display author names and emails in report", false)
  .action(async (repoPath: string, options: any) => {
    try {
      if (process.env.GITHUB_EVENT_NAME === "pull_request_target") {
        console.warn(
          "Warning: pull_request_target runs with elevated repository privileges. agent-roast recommends running on 'pull_request'."
        );
      }

      // Load repository config (.agentroastrc.json / agent-roast.config.json)
      const config = await loadConfig(repoPath);

      if (options.base) {
        // PR Mode
        let failOnRules: string[];
        if (options.failOn) {
          failOnRules = options.failOn.split(",").map((s: string) => s.trim()).filter(Boolean);
        } else {
          const errorRules = Object.entries(config.rules || {})
            .filter(([_, level]) => level === "error")
            .map(([rule]) => rule);
          failOnRules = errorRules.length > 0 ? errorRules : ["test-skip"];
        }

        const chosenFormat = options.json ? "json" : options.format || "terminal";

        const prResult = await auditPullRequest({
          cwd: repoPath,
          base: options.base,
          head: options.head || "HEAD",
          failOn: failOnRules,
          format: chosenFormat,
          verbose: options.verbose,
          authors: options.authors,
          ignorePaths: config.ignorePaths,
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
          ignorePaths: config.ignorePaths,
        });

        if (options.json) {
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

program.parse(process.argv);

