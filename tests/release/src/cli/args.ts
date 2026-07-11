import { parseDesktopMode, parseTargetLane, type DesktopMode, type TargetLane } from "../config/types.js";
import { RELEASE_POLICY_ENV, parseReleasePolicy, type ReleasePolicy } from "../runner/workflow-policy.js";

export interface CliArgs {
  lane: TargetLane;
  desktop: DesktopMode;
  agents: string[] | "all";
  scenarios: string[] | "all";
  /**
   * Release policy (WS10a). `signal` (default) is the informational nightly
   * mode — unchanged behavior. `release` is strict: the required-scenario
   * manifest gates the run and a summary artifact is emitted. Selected by
   * `--policy` or the `RELEASE_POLICY` env var, the flag winning.
   */
  policy: ReleasePolicy;
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
  // Default resolved from RELEASE_POLICY (falls back to signal) so an
  // un-flagged run behaves exactly as it does today.
  policy: parseReleasePolicy(process.env[RELEASE_POLICY_ENV]),
  dryRun: false,
  fileIssues: false,
  // Relative to this package's own cwd (`tests/release/`), which is what
  // both `make release-e2e` and a direct `pnpm exec tsx src/cli/run.ts` use
  // — found running this for real 2026-07-08: the previous default
  // ("tests/release/.output") double-nested into
  // tests/release/tests/release/.output instead.
  outputDir: ".output",
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
      case "--only":
        // --only is sugar for --scenarios (per the tier-3 build task: "runner
        // should support --only <id>"); both set the same field.
        args.scenarios = parseListFlag(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--policy":
        args.policy = parseReleasePolicy(requireValue(argv, i, arg));
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
  --only <id>                Alias for --scenarios with a single id (e.g. --only T3-WT-1)
  --policy <signal|release>  Release policy (default: RELEASE_POLICY env, else signal). release = strict:
                             the required-scenario manifest gates the run and a summary artifact is written.
  --dry-run                  Report the plan + env manifest; never call a real provider/LLM
  --file-issues              File one GitHub issue per distinct failure via \`gh\` (default: off)
  --output-dir <path>        Where failure reports are written, relative to tests/release/ (default: .output)
  --help                     Show this text
`;
