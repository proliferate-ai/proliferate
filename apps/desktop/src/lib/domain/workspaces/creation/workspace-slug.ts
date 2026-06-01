import type { Workspace } from "@anyharness/sdk";
import { localWorkspaceGroupKey } from "@/lib/domain/workspaces/cloud/collections";

// Single-word default for new worktrees. Kept short and human. Collisions are
// rare given the list size and per-repo scope; if one happens, the server
// rejects the path and the next attempt rolls a fresh word.
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

export function generateWorkspaceSlug(existingNames: ReadonlySet<string>): string {
  const available = NOUNS.filter((noun) => !existingNames.has(noun));
  if (available.length > 0) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return available[bytes[0]! % available.length]!;
  }

  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const base = NOUNS[bytes[0]! % NOUNS.length]!;
  for (let i = 2; i < 100000; i++) {
    const candidate = `${base}-${i}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

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
