import type { SetupScriptExecution, Workspace, WorkspaceKind } from "@anyharness/sdk";
import { WORKSPACE_ARRIVAL_LABELS } from "@/config/workspace-arrival";
import { localWorkspaceGroupKey } from "@/lib/domain/workspaces/collections";
import { workspaceBranchLabel, workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";

export interface WorkspaceArrivalEvent {
  workspaceId: string;
  source: "local-created" | "worktree-created" | "cloud-created" | "cowork-created";
  setupScript?: SetupScriptExecution | null;
  baseBranchName?: string | null;
  createdAt: number;
}

interface WorkspaceArrivalBaseViewModel {
  workspaceId: string;
  source: WorkspaceArrivalEvent["source"];
  kind: "workspace" | "worktree";
  workspacePath: string;
  workspaceKind: WorkspaceKind;
  workspaceName: string;
  repoName: string;
  badgeLabel: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  setupTitle: string;
  setupSummary: string;
  setupCommand: string | null;
  setupActionLabel: string;
  setupStatusLabel: string;
  setupTone: "default" | "success" | "destructive";
  setupDetail: string | null;
  setupTerminalId: string | null;
}

export interface WorktreeArrivalViewModel extends WorkspaceArrivalBaseViewModel {
  kind: "worktree";
  branchName: string;
  baseBranchName: string | null;
}

export interface WorkspaceCreatedArrivalViewModel extends WorkspaceArrivalBaseViewModel {
  kind: "workspace";
}

export type WorkspaceArrivalViewModel =
  | WorktreeArrivalViewModel
  | WorkspaceCreatedArrivalViewModel;

// Single-word default for new worktrees. Kept short and human — no
// adjective+noun+suffix scaffolding. Collisions are rare given the list
// size and per-repo scope; if one happens, the server rejects the path
// and the next attempt rolls a fresh word.
const NOUNS = [
  "abalone", "acacia", "agate", "alabaster", "albatross", "alder", "almond",
  "amber", "amethyst", "anchovy", "anemone", "angelfish", "ant", "antelope",
  "apple", "apricot", "aquamarine", "archipelago", "arctic", "ash", "aspen",
  "aster", "atoll", "aurora", "avalanche", "azalea", "azure",
  "badger", "bamboo", "banyan", "baobab", "barnacle", "barracuda", "basalt",
  "basil", "basin", "bat", "bay", "bayou", "beach", "beacon", "bear",
  "beaver", "bee", "beech", "beetle", "beluga", "beryl", "birch", "bison",
  "blizzard", "bloom", "bluebell", "bluejay", "boar", "bobcat", "bonfire",
  "bonito", "bonsai", "bramble", "breeze", "briar", "brine", "bronze",
  "brook", "broom", "buckeye", "buffalo", "bunting", "butte", "butterfly",
  "cactus", "cairn", "calcite", "camel", "canary", "canyon", "capybara",
  "cardinal", "caribou", "carp", "cascade", "catfish", "cave", "cedar",
  "chalk", "chamois", "channel", "charcoal", "cheetah", "chert", "chestnut",
  "chickadee", "chinchilla", "cinder", "cinnamon", "citrine", "clam",
  "clay", "cliff", "cloud", "clover", "cobalt", "cod", "comet", "conch",
  "condor", "copper", "coral", "cormorant", "cougar", "cove", "coyote",
  "crab", "crag", "crane", "crater", "creek", "cricket", "crimson", "crocus",
  "crow", "crystal", "cuckoo", "curlew", "current", "cyclone", "cypress",
  "daffodil", "dahlia", "daisy", "dale", "damselfly", "dandelion", "dawn",
  "deer", "delta", "dew", "dingo", "doe", "dogwood", "dolphin", "donkey",
  "dove", "dragonfly", "drift", "drizzle", "dune", "dunlin", "dusk",
  "eagle", "ebony", "eclipse", "eel", "egret", "eider", "elder", "elephant",
  "elk", "elm", "ember", "emerald", "equinox", "ermine", "eucalyptus",
  "falcon", "falls", "fawn", "feldspar", "fen", "fennel", "fern", "ferret",
  "fig", "finch", "fir", "firefly", "fjord", "flame", "flare", "flash",
  "flicker", "flint", "flounder", "flurry", "fog", "foothill", "ford", "fox",
  "foxglove", "frost", "fuchsia",
  "gale", "gannet", "garnet", "gazelle", "gecko", "geode", "geranium",
  "geyser", "ginger", "ginkgo", "glade", "gleam", "glen", "glimmer", "glow",
  "gneiss", "godwit", "goldfinch", "gopher", "gorge", "grackle", "granite",
  "grebe", "grouse", "grove", "gulch", "gull", "gust", "gypsum",
  "haddock", "hail", "halibut", "halo", "harbor", "hare", "harrier", "hawk",
  "hawthorn", "hazel", "heath", "heather", "hedgehog", "hemlock", "heron",
  "herring", "hibiscus", "hickory", "highland", "hollow", "holly", "hoopoe",
  "hornbill", "hornet", "hyacinth",
  "ibex", "ibis", "impala", "indigo", "inlet", "iris", "iron", "isle",
  "ivory", "ivy",
  "jackdaw", "jade", "jaguar", "jasmine", "jasper", "jay", "jellyfish",
  "jerboa", "junco", "juniper",
  "kelp", "kestrel", "kingfisher", "kite", "kiwi", "knoll", "koala", "koi",
  "kookaburra", "krill",
  "lagoon", "lake", "lamprey", "lantern", "lapis", "larch", "lark", "laurel",
  "lava", "lavender", "lemur", "leopard", "lichen", "lilac", "lily", "lime",
  "linden", "linnet", "lion", "llama", "lobster", "locust", "loon", "lotus",
  "lupine", "lynx",
  "mackerel", "magnolia", "magpie", "mahogany", "mallow", "manatee", "mango",
  "manta", "mantis", "maple", "marble", "marigold", "marlin", "marmot",
  "marsh", "marten", "martin", "mauve", "meadow", "meerkat", "merlin",
  "mesa", "mica", "midge", "milkweed", "mink", "mint", "mist", "mole",
  "monarch", "mongoose", "monsoon", "moonstone", "moor", "moose", "moss",
  "moth", "mountain", "mussel", "myrtle",
  "narwhal", "nautilus", "nebula", "nettle", "nightingale", "nimbus", "nova",
  "nuthatch",
  "oak", "oasis", "obsidian", "ocelot", "ochre", "octopus", "okapi", "olive",
  "onyx", "opal", "opossum", "orca", "orchid", "oriole", "osprey", "otter",
  "owl", "oyster",
  "palm", "panda", "pansy", "panther", "papaya", "parrot", "peach", "peacock",
  "peak", "pear", "pearl", "pecan", "pelican", "peony", "perch", "peridot",
  "periwinkle", "petrel", "pheasant", "pigeon", "pike", "pine", "plain",
  "plateau", "platypus", "plover", "plum", "polecat", "pollen", "pond",
  "poplar", "poppy", "porcupine", "porpoise", "prairie", "primrose", "prism",
  "puffin", "puma", "pumice", "pyrite",
  "quail", "quartz", "quince", "quoll",
  "rabbit", "raccoon", "rainbow", "ram", "rapids", "raven", "ravine", "ray",
  "redwood", "reed", "reef", "reindeer", "rhino", "ridge", "rill", "river",
  "robin", "rook", "rose", "rosemary", "rowan", "ruby", "rye",
  "sable", "saffron", "sage", "salmon", "sandpiper", "sapphire", "sardine",
  "savanna", "scallop", "scarab", "scarlet", "schist", "seal", "sequoia",
  "shale", "shark", "shimmer", "shoal", "shore", "shrew", "shrike", "shrimp",
  "sienna", "silver", "siskin", "skink", "slate", "sleet", "slope", "snipe",
  "snow", "snowdrop", "sorrel", "spark", "sparrow", "spinel", "spire",
  "spring", "spruce", "squall", "squirrel", "stag", "starfish", "starling",
  "stoat", "stone", "stork", "storm", "stream", "sturgeon", "sumac", "summit",
  "sunset", "swallow", "swan", "swift", "sycamore",
  "tamarack", "tanager", "tansy", "tarn", "teak", "teal", "tern", "thaw",
  "thicket", "thistle", "thrush", "thunder", "thyme", "tide", "tiger",
  "timber", "topaz", "torch", "tornado", "tortoise", "toucan", "tourmaline",
  "trout", "tulip", "tundra", "turbot", "turquoise", "tussock", "twilight",
  "umber", "urchin",
  "vale", "valley", "vanilla", "verbena", "vermilion", "vervain", "viburnum",
  "viola", "violet", "vortex", "vulture",
  "wagtail", "walnut", "walrus", "warbler", "waterfall", "waxwing", "weasel",
  "weaver", "whale", "wheat", "whelk", "willow", "wisteria", "wolf",
  "wolverine", "wombat", "woodpecker", "wren",
  "yak", "yarrow", "yew",
  "zebra", "zenith", "zephyr", "zinc", "zinnia", "zircon",
];

/**
 * Pick a worktree slug that doesn't collide with `existingNames`.
 *
 * Filters the curated noun list to words not yet taken in the caller's
 * scope (typically: existing worktree path basenames in the same repo),
 * then picks uniformly from the survivors. If every curated word is
 * already taken — only possible at 562+ worktrees in one repo — falls
 * back to appending a numeric suffix to a random base noun.
 */
export function generateWorkspaceSlug(existingNames: ReadonlySet<string>): string {
  const available = NOUNS.filter((noun) => !existingNames.has(noun));
  if (available.length > 0) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return available[bytes[0]! % available.length]!;
  }

  // All curated nouns are taken in this scope. Pick a random base and
  // append the smallest free numeric suffix. Bounded loop for safety.
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const base = NOUNS[bytes[0]! % NOUNS.length]!;
  for (let i = 2; i < 100000; i++) {
    const candidate = `${base}-${i}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }
  // Pathological: should never happen.
  return `${base}-${Date.now()}`;
}

/**
 * Collect the set of worktree directory basenames already in use within the
 * same repo group as `source`. Feed this to `generateWorkspaceSlug` so it
 * avoids picking a noun that would collide with an existing worktree path.
 */
export function collectWorktreeBasenamesForRepo(
  workspaces: readonly Workspace[],
  source: Workspace,
): Set<string> {
  const sourceGroupKey = localWorkspaceGroupKey(source);
  const basenames = new Set<string>();
  for (const workspace of workspaces) {
    if (workspace.kind !== "worktree") continue;
    if (localWorkspaceGroupKey(workspace) !== sourceGroupKey) continue;
    const basename = workspace.path.split("/").filter(Boolean).pop();
    if (basename) basenames.add(basename);
  }
  return basenames;
}

export function summarizeSetupFailure(setup: SetupScriptExecution): string {
  const output = `${setup.stderr}\n${setup.stdout}`.trim();
  const firstLine = output.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) {
    return `Setup failed with exit code ${setup.exitCode}.`;
  }

  return `Setup failed with exit code ${setup.exitCode}: ${firstLine}`;
}

export function buildWorkspaceArrivalEvent(input: {
  workspaceId: string;
  source: WorkspaceArrivalEvent["source"];
  setupScript?: SetupScriptExecution | null;
  baseBranchName?: string | null;
}): WorkspaceArrivalEvent {
  return {
    workspaceId: input.workspaceId,
    source: input.source,
    setupScript: input.setupScript ?? null,
    baseBranchName: input.baseBranchName ?? null,
    createdAt: Date.now(),
  };
}

// TOOD lol this is a mess
export function buildWorkspaceArrivalViewModel(args: {
  event: WorkspaceArrivalEvent;
  workspace: Workspace;
  configuredSetupScript: string;
  setupTerminalId?: string | null;
}): WorkspaceArrivalViewModel {
  const { event, workspace } = args;
  const workspaceName = workspace.kind === "worktree"
    ? workspaceDisplayName(workspace)
    : workspace.path.split("/").pop()
      ?? workspace.gitRepoName
      ?? "workspace";
  const repoName = workspace.gitRepoName
    ?? workspace.sourceRepoRootPath?.split("/").pop()
    ?? workspaceName;
  const isWorktree = workspace.kind === "worktree";

  const setupScriptCommand = (event.setupScript?.command ?? args.configuredSetupScript).trim();
  const hasSetupScript = setupScriptCommand.length > 0;
  const setupStatus = event.setupScript?.status ?? null;

  const baseViewModel: WorkspaceArrivalBaseViewModel = {
    workspaceId: workspace.id,
    source: event.source,
    kind: isWorktree ? "worktree" : "workspace",
    workspacePath: workspace.path,
    workspaceKind: workspace.kind,
    workspaceName,
    repoName,
    badgeLabel: resolveWorkspaceArrivalBadge(event.source, isWorktree),
    eyebrow: resolveWorkspaceArrivalEyebrow(event.source, isWorktree),
    title: workspaceName,
    subtitle: resolveWorkspaceArrivalSubtitle(
      event.source,
      repoName,
      isWorktree,
      event.baseBranchName?.trim() || null,
    ),
    setupTitle: WORKSPACE_ARRIVAL_LABELS.setupTitle,
    setupSummary: !hasSetupScript
      ? WORKSPACE_ARRIVAL_LABELS.setupMissing
      : setupStatus === "running"
        ? WORKSPACE_ARRIVAL_LABELS.setupRunning
        : setupStatus === "queued"
          ? WORKSPACE_ARRIVAL_LABELS.setupQueued
          : setupStatus === "succeeded"
            ? WORKSPACE_ARRIVAL_LABELS.setupSucceeded
            : setupStatus === "failed"
              ? summarizeSetupFailure(event.setupScript!)
              : WORKSPACE_ARRIVAL_LABELS.setupConfigured,
    setupCommand: hasSetupScript ? setupScriptCommand : null,
    setupActionLabel: setupStatus === "failed"
      ? "Details"
      : hasSetupScript
        ? WORKSPACE_ARRIVAL_LABELS.repositorySettings
        : WORKSPACE_ARRIVAL_LABELS.addSetup,
    setupStatusLabel: setupStatus === "running"
      ? WORKSPACE_ARRIVAL_LABELS.setupStatusRunning
      : setupStatus === "queued"
        ? WORKSPACE_ARRIVAL_LABELS.setupStatusQueued
        : setupStatus === "failed"
          ? WORKSPACE_ARRIVAL_LABELS.setupFailed
          : setupStatus === "succeeded"
            ? WORKSPACE_ARRIVAL_LABELS.setupStatusReady
            : hasSetupScript
              ? WORKSPACE_ARRIVAL_LABELS.setupStatusConfigured
              : WORKSPACE_ARRIVAL_LABELS.setupStatusOptional,
    setupTone: setupStatus === "failed"
      ? "destructive"
      : setupStatus === "succeeded"
        ? "success"
        : (setupStatus === "running" || setupStatus === "queued")
          ? "default"
          : "default",
    setupDetail: setupStatus === "failed" && event.setupScript
      ? `${event.setupScript.stderr}\n${event.setupScript.stdout}`.trim() || null
      : null,
    setupTerminalId: args.setupTerminalId ?? null,
  };

  if (isWorktree) {
    return {
      ...baseViewModel,
      kind: "worktree",
      branchName: workspaceBranchLabel(workspace),
      baseBranchName: event.baseBranchName?.trim() || null,
    };
  }

  return {
    ...baseViewModel,
    kind: "workspace",
  };
}

function resolveWorkspaceArrivalSubtitle(
  source: WorkspaceArrivalEvent["source"],
  repoName: string,
  isWorktree: boolean,
  baseBranchName: string | null,
): string {
  if (isWorktree) {
    const base = `${WORKSPACE_ARRIVAL_LABELS.worktreeCreatedSubtitlePrefix} ${repoName}`;
    return baseBranchName
      ? `${base} ${WORKSPACE_ARRIVAL_LABELS.worktreeCreatedSubtitleFromInfix} ${baseBranchName}`
      : base;
  }

  return source === "cloud-created"
    ? WORKSPACE_ARRIVAL_LABELS.createdCloudWorkspaceSubtitle
    : WORKSPACE_ARRIVAL_LABELS.createdWorkspaceSubtitle;
}

function resolveWorkspaceArrivalBadge(
  source: WorkspaceArrivalEvent["source"],
  isWorktree: boolean,
): string {
  if (source === "cowork-created") {
    return WORKSPACE_ARRIVAL_LABELS.workspaceBadge;
  }

  if (isWorktree) {
    return WORKSPACE_ARRIVAL_LABELS.newWorktreeBadge;
  }

  if (source === "cloud-created") {
    return WORKSPACE_ARRIVAL_LABELS.newCloudWorkspaceBadge;
  }

  return source === "local-created"
    ? WORKSPACE_ARRIVAL_LABELS.newWorkspaceBadge
    : WORKSPACE_ARRIVAL_LABELS.workspaceBadge;
}

function resolveWorkspaceArrivalEyebrow(
  source: WorkspaceArrivalEvent["source"],
  isWorktree: boolean,
): string {
  if (isWorktree) {
    return WORKSPACE_ARRIVAL_LABELS.worktreeCreatedEyebrow;
  }

  if (source === "cloud-created") {
    return WORKSPACE_ARRIVAL_LABELS.cloudWorkspaceCreatedEyebrow;
  }

  return WORKSPACE_ARRIVAL_LABELS.workspaceCreatedEyebrow;
}
