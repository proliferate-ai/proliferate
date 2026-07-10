export const DIFF_AUTO_COLLAPSE_LINE_LIMIT = 1_000;
export const DIFF_HARD_INLINE_LINE_LIMIT = 5_000;
export const DIFF_HARD_INLINE_BYTE_LIMIT = 250_000;
export const CHAT_VISIBLE_FILE_CHANGE_LIMIT = 3;
export const GIT_DIFF_FETCH_CONCURRENCY_LIMIT = 5;
/**
 * Above this many diff lines, sidebar review cards opt their diff rows into
 * content-visibility row virtualization (the [data-diff-row-virtualization]
 * rule in design/src/css/desktop.css) so off-screen rows of one large file
 * skip layout/paint. Small diffs stay un-contained: full paint is already
 * cheap and per-row containment has its own overhead.
 */
export const DIFF_ROW_VIRTUALIZATION_LINE_THRESHOLD = 300;

export type DiffDisplayPolicyKind =
  | "safe"
  | "collapsedLarge"
  | "collapsedGenerated"
  | "tooLargeInline";

export interface DiffDisplayPolicyInput {
  path: string;
  additions?: number | null;
  deletions?: number | null;
  patch?: string | null;
}

export interface DiffDisplayPolicy {
  kind: DiffDisplayPolicyKind;
  changedLines: number;
  patchLineCount: number;
  patchByteCount: number;
  generated: boolean;
  shouldAutoCollapse: boolean;
  canFetchInline: boolean;
  canRenderInline: boolean;
  placeholderTitle: string;
  placeholderDescription: string;
}

export interface DiffDisplayPolicySummary {
  total: number;
  generated: number;
  large: number;
  tooLargeInline: number;
}

export function resolveDiffDisplayPolicy({
  path,
  additions,
  deletions,
  patch,
}: DiffDisplayPolicyInput): DiffDisplayPolicy {
  const changedLines = diffChangedLineCount(additions, deletions);
  const patchLineCount = patch ? patch.split("\n").length : 0;
  const patchByteCount = patch ? utf8ByteLength(patch) : 0;
  const generated = isGeneratedDiffPath(path);
  const tooLargeInline =
    changedLines > DIFF_HARD_INLINE_LINE_LIMIT
    || patchLineCount > DIFF_HARD_INLINE_LINE_LIMIT
    || patchByteCount > DIFF_HARD_INLINE_BYTE_LIMIT;

  if (tooLargeInline) {
    return buildPolicy({
      kind: "tooLargeInline",
      changedLines,
      patchLineCount,
      patchByteCount,
      generated,
      shouldAutoCollapse: true,
      canFetchInline: false,
      canRenderInline: false,
    });
  }

  if (
    changedLines > DIFF_AUTO_COLLAPSE_LINE_LIMIT
    || patchLineCount > DIFF_AUTO_COLLAPSE_LINE_LIMIT
  ) {
    return buildPolicy({
      kind: "collapsedLarge",
      changedLines,
      patchLineCount,
      patchByteCount,
      generated,
      shouldAutoCollapse: true,
      canFetchInline: true,
      canRenderInline: true,
    });
  }

  if (generated) {
    return buildPolicy({
      kind: "collapsedGenerated",
      changedLines,
      patchLineCount,
      patchByteCount,
      generated,
      shouldAutoCollapse: true,
      canFetchInline: true,
      canRenderInline: true,
    });
  }

  return buildPolicy({
    kind: "safe",
    changedLines,
    patchLineCount,
    patchByteCount,
    generated,
    shouldAutoCollapse: false,
    canFetchInline: true,
    canRenderInline: true,
  });
}

export function diffChangedLineCount(
  additions: number | null | undefined,
  deletions: number | null | undefined,
): number {
  return Math.max(0, additions ?? 0) + Math.max(0, deletions ?? 0);
}

export function summarizeDiffDisplayPolicies(
  policies: readonly DiffDisplayPolicy[],
): DiffDisplayPolicySummary {
  return policies.reduce<DiffDisplayPolicySummary>(
    (summary, policy) => {
      if (policy.kind === "safe") {
        return summary;
      }
      summary.total += 1;
      if (policy.kind === "collapsedGenerated") {
        summary.generated += 1;
      } else if (policy.kind === "collapsedLarge") {
        summary.large += 1;
      } else if (policy.kind === "tooLargeInline") {
        summary.tooLargeInline += 1;
      }
      return summary;
    },
    { total: 0, generated: 0, large: 0, tooLargeInline: 0 },
  );
}

export function isGeneratedDiffPath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  if (
    hasPathSegment(normalizedPath, "generated")
    || hasPathSegment(normalizedPath, "__generated__")
    || hasPathSegment(normalizedPath, "gen")
  ) {
    return true;
  }
  if (
    basename === "openapi.json"
    || basename === "openapi.ts"
    || basename === "schema.json"
    || basename === "package-lock.json"
    || basename === "pnpm-lock.yaml"
    || basename === "yarn.lock"
    || basename === "cargo.lock"
    || basename === "uv.lock"
  ) {
    return true;
  }
  return basename.endsWith(".snap") || basename.endsWith(".snapshot");
}

function buildPolicy(
  input: Omit<DiffDisplayPolicy, "placeholderTitle" | "placeholderDescription">,
): DiffDisplayPolicy {
  const lineLabel = formatChangedLineCount(input.changedLines);
  const placeholderTitle = input.kind === "tooLargeInline"
    ? "Too large to render inline"
    : input.kind === "collapsedGenerated"
      ? "Generated diff collapsed"
      : input.kind === "collapsedLarge"
        ? "Large diff collapsed"
        : "Diff ready";
  const placeholderDescription = input.kind === "tooLargeInline"
    ? [
        `${lineLabel} exceeds the inline renderer limit.`,
        "Open the file to inspect it without loading the full diff here.",
      ].join(" ")
    : input.kind === "collapsedGenerated"
      ? `${lineLabel} in a generated file. Expand only when you need to inspect it.`
      : input.kind === "collapsedLarge"
        ? `${lineLabel}. Expand only when you need to inspect it.`
        : `${lineLabel}.`;

  return {
    ...input,
    placeholderTitle,
    placeholderDescription,
  };
}

function formatChangedLineCount(changedLines: number): string {
  const formatted = changedLines.toLocaleString("en-US");
  return `${formatted} changed line${changedLines === 1 ? "" : "s"}`;
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length;
}

function hasPathSegment(path: string, segment: string): boolean {
  return path.split("/").includes(segment);
}
