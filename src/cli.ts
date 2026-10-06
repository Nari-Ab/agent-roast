import { Command } from "commander";
import { createRequire } from "module";
import * as fs from "fs";
import {
  roastRepository,
  auditPullRequest,
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
  .version(pkg.version || "0.2.0")
  .argument("[path]", "Path to git repository (default: current directory)", ".")
  .option("-a, --all", "Audit ALL commits regardless of AI attribution tags", false)
  .option("-s, --since <time>", "Time window for git analysis", "90 days ago")
  .option("-v, --verbose", "Show commit SHAs and line snippets for all infractions", false)
  .option("--json", "Output results as raw JSON", false)
  .option("--base <ref>", "Base git ref/branch for PR mode audit (e.g. origin/main)")
  .option("--head <ref>", "Head git ref/SHA for PR mode audit (default: HEAD)", "HEAD")
  .option("--fail-on <rules>", "Comma-separated detectors that trigger CI failure", "test-skip")
  .option("--format <format>", "Output format: terminal, json, github", "terminal")
  .option("--authors", "Display author names and emails in report", false)
  .action(async (repoPath: string, options: any) => {
    try {
      if (process.env.GITHUB_EVENT_NAME === "pull_request_target") {
        console.warn(
          "Warning: pull_request_target runs with elevated repository privileges. agent-roast recommends running on 'pull_request'."
        );
      }

      if (options.base) {
        // PR Mode
        const failOnRules = options.failOn
          ? options.failOn.split(",").map((s: string) => s.trim()).filter(Boolean)
          : ["test-skip"];

        const chosenFormat = options.json ? "json" : options.format || "terminal";

        const prResult = await auditPullRequest({
          cwd: repoPath,
          base: options.base,
          head: options.head || "HEAD",
          failOn: failOnRules,
          format: chosenFormat,
          verbose: options.verbose,
          authors: options.authors,
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
        });

        if (options.json) {
          console.log(JSON.stringify(result.summary, null, 2));
        } else {
          console.log(result.output);
        }
        process.exitCode = 0;
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

program.parse(process.argv);

