import { parseDesktopMode, parseTargetLane, type DesktopMode, type TargetLane } from "../config/types.js";

export interface CliArgs {
  lane: TargetLane;
  desktop: DesktopMode;
  agents: string[] | "all";
  scenarios: string[] | "all";
  dryRun: boolean;
  fileIssues: boolean;
  outputDir: string;
  help: boolean;
}

const DEFAULTS: Omit<CliArgs, "help"> = {
  lane: "local",
  desktop: "web",
  agents: "all",
  scenarios: "all",
  dryRun: false,
  fileIssues: false,
  outputDir: "tests/release/.output",
};

/**
 * Manual argv parser, matching this repo's existing script convention
 * (see scripts/build-template.mjs) rather than adding a CLI-parsing
 * dependency for a handful of flags.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { ...DEFAULTS, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--lane":
        args.lane = parseTargetLane(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--desktop":
        args.desktop = parseDesktopMode(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--agents":
        args.agents = parseListFlag(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--scenarios":
        args.scenarios = parseListFlag(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--file-issues":
        args.fileIssues = true;
        break;
      case "--output-dir":
        args.outputDir = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}. Run with --help for usage.`);
    }
  }

  return args;
}

function parseListFlag(value: string): string[] | "all" {
  if (value === "all") {
    return "all";
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export const HELP_TEXT = `
Usage: pnpm exec tsx src/cli/run.ts [flags]
   or: make release-e2e LANE=local|staging DESKTOP=web|native AGENTS=all SCENARIOS=all DRY_RUN=1

Flags:
  --lane <local|staging>     Which target server the runtime lanes talk to (default: local)
  --desktop <web|native>     Desktop lane to drive (default: web)
  --agents <list|all>        Comma-separated harness kinds, or "all" (default: all)
  --scenarios <list|all>     Comma-separated scenario ids, or "all" (default: all)
  --dry-run                  Report the plan + env manifest; never call a real provider/LLM
  --file-issues              File one GitHub issue per distinct failure via \`gh\` (default: off)
  --output-dir <path>        Where failure reports are written (default: tests/release/.output)
  --help                     Show this text
`;
