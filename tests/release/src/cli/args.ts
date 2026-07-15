import { parseDesktopMode, parseTargetLane, type DesktopMode, type TargetLane } from "../config/types.js";
import type { ResultBehavior } from "../runner/result.js";

export interface CliArgs {
  lane: TargetLane;
  desktop: DesktopMode;
  agents: string[] | "all";
  scenarios: string[] | "all";
  behavior: ResultBehavior;
  dryRun: boolean;
  fileIssues: boolean;
  outputDir: string;
  runId?: string;
  shardId?: string;
  attempt?: number;
  /** Path to a CandidateBuildMapV1 JSON file. Required for strict real runs. */
  candidateBuildMap?: string;
  help: boolean;
}

/** Invalid command-line syntax or an invalid invocation; the process exits 2. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const DEFAULTS = {
  lane: "local" as TargetLane,
  desktop: "web" as DesktopMode,
  agents: "all" as string[] | "all",
  scenarios: "all" as string[] | "all",
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
 * dependency for a handful of flags. All syntax and invocation validation
 * happens here, before any identity, setup, or scenario work.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const args: Omit<CliArgs, "behavior"> & { behavior?: ResultBehavior } = { ...DEFAULTS, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--lane":
        args.lane = wrapUsage(() => parseTargetLane(requireValue(argv, i, arg)));
        i += 1;
        break;
      case "--desktop":
        args.desktop = wrapUsage(() => parseDesktopMode(requireValue(argv, i, arg)));
        i += 1;
        break;
      case "--agents":
        args.agents = parseListFlag(arg, requireValue(argv, i, arg));
        i += 1;
        break;
      case "--scenarios":
      case "--only":
        // --only is sugar for --scenarios (per the tier-3 build task: "runner
        // should support --only <id>"); both set the same field.
        args.scenarios = parseListFlag(arg, requireValue(argv, i, arg));
        i += 1;
        break;
      case "--behavior":
        args.behavior = parseBehavior(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--run-id":
        args.runId = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--shard-id":
        args.shardId = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--attempt":
        args.attempt = parseAttempt(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--candidate-build-map":
        args.candidateBuildMap = requireValue(argv, i, arg);
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
        throw new CliUsageError(`Unknown flag: ${arg}. Run with --help for usage.`);
    }
  }

  if (args.help) {
    return { ...args, behavior: args.behavior ?? "diagnostic" };
  }
  if (args.behavior === undefined) {
    throw new CliUsageError("--behavior <diagnostic|strict> is required for direct command use.");
  }
  if (args.behavior === "strict" && args.dryRun) {
    throw new CliUsageError("--behavior strict cannot be combined with --dry-run.");
  }
  // Strict real runs are fail-closed on artifact identity: without a
  // candidate build map the run cannot say which bytes it qualified.
  if (args.behavior === "strict" && args.candidateBuildMap === undefined) {
    throw new CliUsageError("--candidate-build-map <path> is required for strict runs.");
  }
  return { ...args, behavior: args.behavior };
}

function parseBehavior(value: string): ResultBehavior {
  if (value === "diagnostic" || value === "strict") {
    return value;
  }
  throw new CliUsageError(`--behavior must be "diagnostic" or "strict", got "${value}".`);
}

function parseAttempt(value: string): number {
  const attempt = Number(value);
  if (!Number.isInteger(attempt) || attempt < 1 || !/^\d+$/.test(value)) {
    throw new CliUsageError(`--attempt must be a positive integer, got "${value}".`);
  }
  return attempt;
}

function parseListFlag(flag: string, value: string): string[] | "all" {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new CliUsageError(`${flag} received an empty list.`);
  }
  if (entries.includes("all")) {
    if (entries.length > 1) {
      throw new CliUsageError(`${flag} cannot mix "all" with named values.`);
    }
    return "all";
  }
  const duplicates = entries.filter((entry, index) => entries.indexOf(entry) !== index);
  if (duplicates.length > 0) {
    throw new CliUsageError(`${flag} has duplicate value(s): ${[...new Set(duplicates)].join(", ")}.`);
  }
  return entries;
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return value;
}

function wrapUsage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
}

export const HELP_TEXT = `
Usage: pnpm exec tsx src/cli/run.ts --behavior <diagnostic|strict> [flags]
   or: make release-e2e BEHAVIOR=diagnostic|strict LANE=local|staging DESKTOP=web|native AGENTS=all SCENARIOS=all DRY_RUN=1

Flags:
  --behavior <diagnostic|strict>  Required. Diagnostic tolerates blocked/expected-fail; strict is a fail-closed gate.
  --lane <local|staging>     Which target server the runtime lanes talk to (default: local)
  --desktop <web|native>     Desktop lane to drive (default: web)
  --agents <list|all>        Comma-separated harness kinds, or "all" (default: all)
  --scenarios <list|all>     Comma-separated scenario ids, or "all" (default: all)
  --only <id>                Alias for --scenarios with a single id (e.g. --only T3-WT-1)
  --dry-run                  Plan every selected test (calls plan(), never run()); diagnostic only
  --file-issues              File one GitHub issue per distinct failure via \`gh\` (default: off)
  --output-dir <path>        Where the combined report is written, relative to tests/release/ (default: .output)
  --run-id <safe-id>         Optional run identity override
  --shard-id <safe-id>       Optional shard identity override
  --attempt <n>              Optional attempt override (positive integer)
  --candidate-build-map <path>  CandidateBuildMapV1 JSON (required for strict; optional and recorded when supplied)
  --help                     Show this text
`;
