#!/usr/bin/env node
/**
 * Parses the LIVE library registry (apps/packages/product-client/src/components/
 * playground/library/{primitives,patterns,icons,product-patterns}.tsx) into a
 * flat entry list, statically — no TS/vite compilation, just source text.
 *
 * Every fact here (subpaths, groups, modes) is derived from the registry files
 * or from CONTRACT.md's rules at parse/compute time — nothing is hardcoded
 * per-component, so this survives the in-flight kit-move PRs (composer/toast/
 * sidebar/settings relocating into primitives/patterns/<kit>/ subdirs): only
 * the registry files' `subpath` strings change, and those are read fresh.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const LIBRARY_DIR = path.join(
  REPO_ROOT,
  "apps/packages/product-client/src/components/playground/library",
);

// tierId -> [registry file, expected entry count]. Counts are a hard gate:
// a registry edit that adds/removes an entry without updating this file (or
// this file going stale vs. the registry) fails loudly instead of silently
// shipping a partial payload.
const TIER_FILES = [
  { tierId: "primitives", file: "primitives.tsx", expectedCount: 36 },
  { tierId: "patterns", file: "patterns.tsx", expectedCount: 24 },
  { tierId: "icons", file: "icons.tsx", expectedCount: 10 },
  { tierId: "product-patterns", file: "product-patterns.tsx", expectedCount: 11 },
];
const EXPECTED_TOTAL = 36 + 24 + 10 + 11;

/** tierId -> absolute path of the registry file that defines that tier's
 * demos (used by make-meta.mjs to hash "the registry tier file containing
 * the entry's demo"). */
export function tierFilePath(tierId) {
  const hit = TIER_FILES.find((t) => t.tierId === tierId);
  if (!hit) throw new Error(`registry-manifest: unknown tierId "${tierId}"`);
  return path.join(LIBRARY_DIR, hit.file);
}

// Matches `name: "...", subpath: "...",` pairs where the two keys sit
// adjacent in source (true of every real LibraryEntry literal today). This
// is exactly what excludes the one known false positive: SecretManagement-
// PanelDemo's envVars fixture has `name: "API_KEY"` immediately followed by
// `byteSize:`, never by `subpath:`, so it never matches.
const ENTRY_RE = /name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*subpath:\s*"((?:[^"\\]|\\.)*)"/g;

// Card-mode overrides, verbatim from CONTRACT.md's "Card modes" table,
// matched against on the sanitized display name (see displayNameOf below) —
// intersected against whatever the registry actually contains.
const SINGLE_MODE_NAMES = new Set([
  "Dialog", "AlertDialog", "ModalShell", "ConfirmationDialog", "CommandPalette",
  "Popover", "PopoverButton", "DropdownMenu", "SettingsMenu",
  "EnvironmentSearchSelect", "PickerPopoverContent", "FixedPositionLayer",
  "ToastHost", "Sonner",
]);
const COLUMN_MODE_NAMES = new Set([
  "ModelTable", "ProductPageShell", "SettingsPageHeader", "PageContentFrame",
  "SettingsRow", "SettingsSaveFooter", "SettingsScopeTabs", "SettingsSection",
  "SettingsEmptyState", "AutoHideScrollArea", "ComposerControlButton",
  "ComposerTextarea", "ComposerTextareaFrame", "PageHeader",
  "PaneOptionsMenuItem", "ThinkingText", "AnimatedCollapsibleContent",
  "AnimatedSwapText", "Command", "PopoverMenuItem", "RangeSlider",
  "RowActionIconButton", "Switch", "Tooltip", "SecretManagementPanel",
  "BillingGateState", "PrStatusBadge",
]);

/** Registry names are (mostly) already path-safe. One exception today:
 * "secrets/SecretManagementPanel" (the domain-aware tier nests it under a
 * secrets/ subfolder). Take the trailing path segment for anything that
 * needs to be a file/dir name or a group-prefix match; keep the raw name
 * for the __demos registry key, since that's what the bundle keys on. */
function displayNameOf(name) {
  return name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
}

/** `#product/<rel>` -> apps/packages/product-client/src/<rel>.tsx */
function resolveSrcFile(subpath) {
  if (!subpath.startsWith("#product/")) {
    throw new Error(`registry-manifest: subpath does not start with #product/: ${subpath}`);
  }
  const rel = subpath.slice("#product/".length);
  return path.join(REPO_ROOT, "apps/packages/product-client/src", `${rel}.tsx`);
}

function groupFor(displayName, tierId) {
  if (displayName.startsWith("Composer") || displayName === "LevelBarsButton") return "composer";
  if (displayName === "ToastHost" || displayName === "Sonner" || displayName.startsWith("Toast")) return "toast";
  if (displayName.startsWith("Sidebar")) return "sidebar";
  if (displayName.startsWith("Settings")) return "settings";
  return tierId;
}

function modeFor(displayName) {
  if (SINGLE_MODE_NAMES.has(displayName)) return "single";
  if (COLUMN_MODE_NAMES.has(displayName)) return "column";
  return "grid";
}

/**
 * @returns {Promise<Array<{
 *   name: string, displayName: string, subpath: string, tierId: string,
 *   group: string, mode: "grid"|"single"|"column", primary: string,
 *   srcFile: string,
 * }>>}
 */
export async function loadRegistryManifest() {
  const entries = [];
  for (const { tierId, file, expectedCount } of TIER_FILES) {
    const filePath = path.join(LIBRARY_DIR, file);
    const source = await readFile(filePath, "utf8");
    const found = [...source.matchAll(ENTRY_RE)].map((m) => ({ name: m[1], subpath: m[2] }));
    if (found.length !== expectedCount) {
      throw new Error(
        `registry-manifest: ${file} matched ${found.length} entries, expected ${expectedCount}.\n` +
          `Matched names: ${found.map((e) => e.name).join(", ") || "(none)"}`,
      );
    }
    for (const { name, subpath } of found) {
      const displayName = displayNameOf(name);
      if (/[/\s]/.test(displayName)) {
        throw new Error(
          `registry-manifest: "${name}" sanitizes to "${displayName}", which is still unsafe for a path segment`,
        );
      }
      const srcFile = resolveSrcFile(subpath);
      if (!existsSync(srcFile)) {
        throw new Error(`registry-manifest: srcFile missing for "${name}" (${subpath}) -> ${srcFile}`);
      }
      const mode = modeFor(displayName);
      entries.push({
        name,
        displayName,
        subpath,
        tierId,
        group: groupFor(displayName, tierId),
        mode,
        primary: mode === "single" ? "Demo" : "",
        srcFile,
      });
    }
  }
  if (entries.length !== EXPECTED_TOTAL) {
    throw new Error(`registry-manifest: expected ${EXPECTED_TOTAL} total entries, got ${entries.length}`);
  }
  const allowedGroups = new Set([
    "primitives", "patterns", "icons", "product-patterns",
    "composer", "toast", "sidebar", "settings",
  ]);
  for (const entry of entries) {
    if (!allowedGroups.has(entry.group)) {
      throw new Error(`registry-manifest: entry "${entry.name}" resolved to unexpected group "${entry.group}"`);
    }
  }
  return entries;
}

// CLI: `node registry-manifest.mjs` prints a summary and exits non-zero on
// any of the hard-fail checks above.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const entries = await loadRegistryManifest();
    const byGroup = {};
    const byMode = {};
    for (const e of entries) {
      byGroup[e.group] = (byGroup[e.group] || 0) + 1;
      byMode[e.mode] = (byMode[e.mode] || 0) + 1;
    }
    console.log(`OK: ${entries.length} entries`);
    console.log("by group:", byGroup);
    console.log("by mode:", byMode);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
