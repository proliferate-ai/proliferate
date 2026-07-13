/**
 * Argument parsing for the foundation runner CLI (`foundation.ts`).
 *
 * Explicit axes only (release-worlds-and-fixtures.md "Vocabulary"): --world,
 * --product-host, --selector/--cells, --behavior, --shard i/n,
 * --candidate-manifest, --retained-manifest, --dry-run. The legacy CLI
 * (`run.ts`) keeps its own `--lane`/`--desktop` flags untouched.
 */

import { ALL_WORLDS, type ProductHost, type ResultBehavior, type WorldId } from "../foundation/contracts/identity.js";

export interface FoundationCliArgs {
  world: WorldId;
  productHost: ProductHost | null;
  selector: string;
  cells: string[];
  behavior: ResultBehavior;
  shardIndex: number;
  shardCount: number;
  candidateManifestPath: string | null;
  retainedManifestPath: string | null;
  dryRun: boolean;
  outputDir: string;
  help: boolean;
}

const DEFAULTS: FoundationCliArgs = {
  world: "tier-2",
  productHost: null,
  selector: "explicit",
  cells: [],
  behavior: "diagnostic",
  shardIndex: 1,
  shardCount: 1,
  candidateManifestPath: null,
  retainedManifestPath: null,
  dryRun: false,
  outputDir: ".output/foundation",
  help: false,
};

export function parseFoundationArgs(argv: readonly string[]): FoundationCliArgs {
  const args: FoundationCliArgs = { ...DEFAULTS, cells: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--world":
        args.world = parseWorld(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--product-host":
        args.productHost = parseProductHost(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--selector":
        args.selector = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--cells":
        args.cells = parseList(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--behavior":
        args.behavior = parseBehavior(requireValue(argv, i, arg));
        i += 1;
        break;
      case "--shard": {
        const { shardIndex, shardCount } = parseShard(requireValue(argv, i, arg));
        args.shardIndex = shardIndex;
        args.shardCount = shardCount;
        i += 1;
        break;
      }
      case "--candidate-manifest":
        args.candidateManifestPath = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--retained-manifest":
        args.retainedManifestPath = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
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

function parseWorld(value: string): WorldId {
  if ((ALL_WORLDS as readonly string[]).includes(value)) return value as WorldId;
  throw new Error(`--world must be one of ${ALL_WORLDS.join(", ")}, got "${value}"`);
}

function parseProductHost(value: string): ProductHost {
  if (value === "desktop-web" || value === "desktop-native" || value === "hosted-web") return value;
  throw new Error(`--product-host must be desktop-web|desktop-native|hosted-web, got "${value}"`);
}

function parseBehavior(value: string): ResultBehavior {
  if (value === "diagnostic" || value === "strict") return value;
  throw new Error(`--behavior must be diagnostic|strict, got "${value}"`);
}

function parseShard(value: string): { shardIndex: number; shardCount: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`--shard must be "i/n" (1-based), got "${value}"`);
  const shardIndex = Number(match[1]);
  const shardCount = Number(match[2]);
  if (shardIndex < 1 || shardCount < 1 || shardIndex > shardCount) {
    throw new Error(`--shard i/n requires 1 <= i <= n, got "${value}"`);
  }
  return { shardIndex, shardCount };
}

function parseList(value: string): string[] {
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

export const FOUNDATION_HELP_TEXT = `
Usage: pnpm exec tsx src/cli/foundation.ts [flags]

Foundation runner (specs/developing/testing/release-worlds-and-fixtures.md).
Explicit axes only; the legacy runner (src/cli/run.ts) is unchanged.

Flags:
  --world <id>                One of: tier-2, local-runtime, managed-cloud, self-host,
                              desktop-upgrade, managed-cloud-upgrade (default: tier-2)
  --product-host <host>       desktop-web | desktop-native | hosted-web (default: none)
  --selector <name>           Selector label recorded in the plan (default: explicit)
  --cells <list>              Comma-separated scenario ids to select (e.g. T2-AUTH-1,T2-INV-1)
  --behavior <b>              diagnostic | strict (default: diagnostic)
  --shard <i/n>               1-based shard i of n (default: 1/1)
  --candidate-manifest <p>    Path to the candidate artifact manifest JSON (required unless --dry-run)
  --retained-manifest <p>     Path to the retained-production manifest JSON (Tier 4 worlds)
  --dry-run                   Emit the plan only; never provision or emit green evidence
  --output-dir <path>         Evidence/ledger output root (default: .output/foundation)
  --help                      Show this text
`;
