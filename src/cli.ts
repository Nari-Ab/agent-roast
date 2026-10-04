import { Command } from "commander";
import { createRequire } from "module";
import { roastRepository } from "./index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("agent-roast")
  .description("Audit your git history for AI coding agent infractions and panic loops")
  .version(pkg.version || "0.1.2")
  .argument("[path]", "Path to git repository (default: current directory)", ".")
  .option("-a, --all", "Audit ALL commits regardless of AI attribution tags", false)
  .option("-s, --since <time>", "Time window for git analysis", "90 days ago")
  .option("-v, --verbose", "Show commit SHAs and line snippets for all infractions", false)
  .option("--json", "Output results as raw JSON", false)
  .action(async (repoPath: string, options: any) => {
    try {
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
    } catch (err: any) {
      console.error(`Error auditing repository: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
