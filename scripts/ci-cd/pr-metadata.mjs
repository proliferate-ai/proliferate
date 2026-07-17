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

export const ALLOWED_RELEASE_NOTE_SECTIONS = Object.freeze([
  "New",
  "Improvement",
  "Fix",
  "Omit",
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

const RELEASE_NOTE_SECTIONS_FOR_LABEL = new Map([
  ["release:large-feature", new Set(["New"])],
  ["release:minor-feature", new Set(["New", "Improvement"])],
  ["release:performance", new Set(["Improvement"])],
  ["release:fix", new Set(["Fix"])],
  ["release:docs", new Set(["Omit"])],
  ["release:maintenance", new Set(["Omit"])],
  ["release:skip", new Set(["Omit"])],
]);

const RELEASE_NOTE_FIELDS = Object.freeze([
  "Section",
  "Title",
  "Description",
  "Group",
]);
const RELEASE_NOTE_PLACEHOLDER = /^(?:todo|tbd|n\/a|[-–—]+|\[.*\]|<.*>)$/i;
const RELEASE_NOTE_GROUP = /^(?:none|[a-z0-9][a-z0-9-]{0,63})$/;

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

function isPlaceholder(value) {
  return value.length === 0 || RELEASE_NOTE_PLACEHOLDER.test(value);
}

/**
 * Parse the one machine-readable release-note block required in a ready PR.
 * HTML comments are ignored so the GitHub template can keep inline guidance
 * without becoming release data.
 */
export function parseReleaseNoteMetadata(body = "") {
  const source = String(body || "");
  const headings = [...source.matchAll(/^## Release note[ \t]*\r?$/gm)];
  if (headings.length !== 1) {
    return {
      releaseNote: null,
      errors: [
        `PR body must contain exactly one "## Release note" block. Found ${headings.length}.`,
      ],
    };
  }

  const start = headings[0].index + headings[0][0].length;
  const remaining = source.slice(start).replace(/^\r?\n/, "");
  const nextHeading = remaining.search(/^##[ \t]+/m);
  const rawBlock = nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
  const block = rawBlock.replace(/<!--[\s\S]*?-->/g, "");
  const fields = new Map();
  const errors = [];

  for (const rawLine of block.split(/\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line) continue;
    const match = /^(Section|Title|Description|Group):[ \t]*(.*)$/.exec(line);
    if (!match) {
      errors.push(`Unexpected release-note line: ${line}`);
      continue;
    }
    const [, field, rawValue] = match;
    if (fields.has(field)) {
      errors.push(`Release-note field ${field} must appear exactly once.`);
      continue;
    }
    fields.set(field, rawValue.trim());
  }

  for (const field of RELEASE_NOTE_FIELDS) {
    if (!fields.has(field)) {
      errors.push(`Release-note field ${field} is required.`);
    }
  }

  const releaseNote = Object.fromEntries(
    RELEASE_NOTE_FIELDS.map((field) => [
      field.toLowerCase(),
      fields.get(field) || "",
    ]),
  );

  if (!ALLOWED_RELEASE_NOTE_SECTIONS.includes(releaseNote.section)) {
    errors.push(
      `Release-note Section must be one of: ${ALLOWED_RELEASE_NOTE_SECTIONS.join(", ")}.`,
    );
  }
  if (isPlaceholder(releaseNote.title)) {
    errors.push("Release-note Title must be complete and cannot be a placeholder.");
  } else if (releaseNote.title.length > 80) {
    errors.push("Release-note Title must be at most 80 characters.");
  }
  if (isPlaceholder(releaseNote.description)) {
    errors.push("Release-note Description must be complete and cannot be a placeholder.");
  } else {
    if (releaseNote.description.length > 300) {
      errors.push("Release-note Description must be at most 300 characters.");
    }
    if (!/[.!?]$/.test(releaseNote.description)) {
      errors.push("Release-note Description must end with ., !, or ?.");
    }
  }
  if (!RELEASE_NOTE_GROUP.test(releaseNote.group)) {
    errors.push(
      "Release-note Group must be none or a lowercase hyphenated key of at most 64 characters.",
    );
  }
  if (
    releaseNote.section === "Omit" &&
    !releaseNote.description.startsWith("No customer-facing behavior change")
  ) {
    errors.push(
      'An Omit release note Description must begin with "No customer-facing behavior change".',
    );
  }

  return { releaseNote, errors };
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
export function validatePullRequestMetadata({
  title,
  body = "",
  labels = [],
  changedFiles = null,
}) {
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

  const parsedReleaseNote = parseReleaseNoteMetadata(body);
  errors.push(...parsedReleaseNote.errors);
  if (
    releaseLabels.length === 1 &&
    allowedReleaseLabels.has(releaseLabels[0]) &&
    parsedReleaseNote.releaseNote &&
    ALLOWED_RELEASE_NOTE_SECTIONS.includes(parsedReleaseNote.releaseNote.section)
  ) {
    const allowedSections = RELEASE_NOTE_SECTIONS_FOR_LABEL.get(releaseLabels[0]);
    if (!allowedSections.has(parsedReleaseNote.releaseNote.section)) {
      errors.push(
        `${releaseLabels[0]} requires release-note Section ${[...allowedSections].join(" or ")}; found ${parsedReleaseNote.releaseNote.section}.`,
      );
    }
  }

  return errors;
}
