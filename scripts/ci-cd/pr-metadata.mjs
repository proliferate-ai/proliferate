import { matches } from "./detect-deploy-surfaces.mjs";

export const ALLOWED_TITLE_TYPES = Object.freeze([
  "feat",
  "fix",
  "perf",
  "docs",
  "refactor",
  "chore",
  "ci",
  "test",
  "build",
  "release",
]);

export const ALLOWED_RELEASE_LABELS = Object.freeze([
  "release:large-feature",
  "release:minor-feature",
  "release:performance",
  "release:fix",
  "release:docs",
  "release:maintenance",
  "release:skip",
]);

export const ALLOWED_AREA_LABELS = Object.freeze([
  "area:desktop",
  "area:anyharness",
  "area:sdk",
  "area:server",
  "area:cloud",
  "area:docs",
  "area:website",
  "area:release",
  "area:product",
]);

const TITLE_PATTERN = new RegExp(
  `^(${ALLOWED_TITLE_TYPES.join("|")})\\([a-z0-9][a-z0-9/-]*\\): [^\\r\\n]+$`,
);

// Area detection reuses the deploy-surface detector's `matches(path, prefixes)`
// convention (see detect-deploy-surfaces.mjs). It is a distinct projection: the
// area:* taxonomy is not the deploy-surface taxonomy, so this classifier maps
// changed paths onto area labels directly rather than translating surfaces.
//
// Each rule contributes candidate area label(s) for a changed path:
// - a path that resolves to exactly one candidate is a REQUIRED area;
// - a path that resolves to two or more candidates is AMBIGUOUS and, unless the
//   PR already applies one of those candidates, blocks for a human choice;
// - a path that resolves to no candidate is neutral and contributes nothing.
//
// Deliberate gaps (reported, not guessed): apps/mobile has no area:* label in
// the fixed taxonomy, so mobile-only paths stay neutral and rely on the
// "at least one area" rule plus explicit author choice. Component identity is
// never guessed into an area label.
const AREA_RULES = Object.freeze([
  // Release/CI/deploy plumbing owns area:release.
  { area: "area:release", test: (p) => p.startsWith(".github/") || matches(p, ["scripts/ci-cd"]) },
  // SDK packages take precedence over the web/runtime prefixes they nest under.
  { area: "area:sdk", test: (p) => matches(p, ["anyharness/sdk", "anyharness/sdk-react", "cloud/sdk"]) },
  {
    area: "area:anyharness",
    test: (p) =>
      matches(p, ["anyharness/crates", "anyharness/tests", "catalogs"]),
  },
  { area: "area:desktop", test: (p) => matches(p, ["apps/desktop"]) },
  { area: "area:website", test: (p) => matches(p, ["apps/web"]) },
  { area: "area:server", test: (p) => matches(p, ["server"]) },
  { area: "area:cloud", test: (p) => matches(p, ["cloud"]) },
  {
    area: "area:docs",
    test: (p) => matches(p, ["specs", "docs"]) || (!p.includes("/") && p.endsWith(".md")),
  },
  // Shared product surfaces are cross-cutting by definition.
  { area: "area:product", test: (p) => matches(p, ["apps/packages"]) },
]);

function candidateAreasForPath(path) {
  const areas = new Set();
  for (const rule of AREA_RULES) {
    if (rule.test(path)) {
      areas.add(rule.area);
    }
  }
  return areas;
}

/**
 * Derive area-label expectations from a PR's changed paths.
 *
 * Returns:
 * - `required`: areas that every applied label set must include;
 * - `ambiguous`: `{ path, candidates }` entries whose area could not be
 *   determined uniquely and which need an explicit human choice.
 */
export function deriveAreaExpectation(changedFiles = []) {
  const required = new Set();
  const ambiguous = [];
  for (const file of changedFiles) {
    const path = typeof file === "string" ? file : file?.filename;
    if (!path) {
      continue;
    }
    const candidates = candidateAreasForPath(path);
    if (candidates.size === 1) {
      required.add([...candidates][0]);
    } else if (candidates.size > 1) {
      ambiguous.push({ path, candidates: [...candidates].sort() });
    }
  }
  return { required: [...required].sort(), ambiguous };
}

function labelNames(labels) {
  return labels
    .map((label) => (typeof label === "string" ? label : label?.name))
    .filter((label) => typeof label === "string" && label.length > 0);
}

/**
 * Validate the PR metadata contract used by both contributors and release
 * tooling. The returned errors are intentionally plain strings so callers can
 * render them in Actions, tests, or local tooling without GitHub dependencies.
 *
 * When `changedFiles` is provided, area labels are additionally checked against
 * the areas derived from the actual changed paths: every clearly-implied area
 * must be applied, and an ambiguous path-to-area result blocks for a human
 * choice rather than guessing a label.
 */
export function validatePullRequestMetadata({ title, labels = [], changedFiles = null }) {
  const names = labelNames(labels);
  const releaseLabels = names.filter((label) => label.startsWith("release:"));
  const areaLabels = names.filter((label) => label.startsWith("area:"));
  const appliedAreas = new Set(areaLabels);
  const allowedReleaseLabels = new Set(ALLOWED_RELEASE_LABELS);
  const allowedAreaLabels = new Set(ALLOWED_AREA_LABELS);
  const errors = [];

  if (!TITLE_PATTERN.test(title || "")) {
    errors.push(
      `PR title must match <type>(<scope>): <change>. Allowed types: ${ALLOWED_TITLE_TYPES.join(", ")}.`,
    );
  }
  if (releaseLabels.length !== 1) {
    errors.push(
      `PR must have exactly one release:* label. Found ${releaseLabels.length}: ${releaseLabels.join(", ") || "none"}.`,
    );
  }
  if (areaLabels.length < 1) {
    errors.push("PR must have at least one area:* label.");
  }

  const invalidReleaseLabels = releaseLabels.filter((label) => !allowedReleaseLabels.has(label));
  if (invalidReleaseLabels.length > 0) {
    errors.push(`Unknown release label(s): ${invalidReleaseLabels.join(", ")}.`);
  }
  const invalidAreaLabels = areaLabels.filter((label) => !allowedAreaLabels.has(label));
  if (invalidAreaLabels.length > 0) {
    errors.push(`Unknown area label(s): ${invalidAreaLabels.join(", ")}.`);
  }

  if (Array.isArray(changedFiles)) {
    const { required, ambiguous } = deriveAreaExpectation(changedFiles);
    const missing = required.filter((area) => !appliedAreas.has(area));
    if (missing.length > 0) {
      errors.push(
        `Changed paths require area label(s): ${missing.join(", ")}. Apply every area affected by the diff.`,
      );
    }
    const unresolved = ambiguous.filter(
      ({ candidates }) => !candidates.some((area) => appliedAreas.has(area)),
    );
    if (unresolved.length > 0) {
      const detail = unresolved
        .map(({ path, candidates }) => `${path} -> ${candidates.join(" | ")}`)
        .join("; ");
      errors.push(
        `Changed paths map to more than one area and none is applied; choose the correct area:* label(s) explicitly: ${detail}.`,
      );
    }
  }

  return errors;
}
