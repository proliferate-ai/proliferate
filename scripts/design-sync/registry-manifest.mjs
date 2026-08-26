#!/usr/bin/env node
/**
 * The pipeline's single view of the LIVE library registry.
 *
 * The registry is NOT parsed. `dump-registry.mjs` compiles-and-executes
 * `LIBRARY_TIERS` (entries are spread in from `library/entries/*.tsx` and the
 * kit demo files, so no regex over the tier files can see the whole set) and
 * writes `.out/.ds-registry-manifest.json`; this module loads that dump and
 * decorates each entry with the facts the payload needs (display name, group,
 * card mode, resolved source file).
 *
 * Every fact here is derived from the dump or from CONTRACT.md's rules at
 * compute time — nothing is hardcoded per-component, so kit moves and new
 * entries flow through without editing this file (only EXPECTED_TOTAL, the
 * deliberate drift tripwire, is pinned).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dumpRegistry, REGISTRY_JSON_PATH } from "./dump-registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const LIBRARY_DIR = path.join(
  REPO_ROOT,
  "apps/packages/product-client/src/components/playground/library",
);

// Total entry count across every tier. This is the drift tripwire the old
// per-tier expectedCounts used to be: a registry edit that adds or retires an
// entry fails here until someone bumps this number ON PURPOSE (and re-syncs
// the payload, which is what the number is really gating).
const EXPECTED_TOTAL = 91;

// tierId -> the file that composes that tier. Entry demos themselves may live
// in `entries/*.tsx` or a kit file; this is the tier's composition point, used
// by make-meta.mjs for the per-entry render hash.
const TIER_FILES = {
  primitives: "primitives.tsx",
  patterns: "patterns.tsx",
  icons: "icons.tsx",
  "product-patterns": "product-patterns.tsx",
};

/** The closed kit set (specs/DESIGN_SYSTEM.md § The library model). A pattern
 * subdirectory outside this set is a doctrine violation, not a new group. */
const KITS = new Set(["composer", "toast", "sidebar", "tabs", "panel", "settings"]);

const ALLOWED_GROUPS = new Set([
  "primitives", "patterns", "icons", "product-patterns", ...KITS,
]);

/** tierId -> absolute path of the tier file that composes that tier's entries
 * (used by make-meta.mjs to hash "the registry file the entry hangs off"). */
export function tierFilePath(tierId) {
  const file = TIER_FILES[tierId];
  if (!file) throw new Error(`registry-manifest: unknown tierId "${tierId}"`);
  return path.join(LIBRARY_DIR, file);
}

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
export function displayNameOf(name) {
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

/**
 * Card "group" for an entry — the ONE definition in the pipeline (make-entry
 * injects the precomputed map into the generated bundle entry; build-bundle
 * reads the decorated entries). Rule order (CONTRACT.md "Groups"):
 *   1. an area-kit subdirectory in the subpath (`primitives/patterns/<kit>/`)
 *   2. else the historical name rules
 *   3. else the owning tier id
 */
export function groupFor(displayName, tierId, subpath) {
  const kitMatch = /\/primitives\/patterns\/([^/]+)\//.exec(subpath);
  if (kitMatch) {
    const kit = kitMatch[1];
    if (!KITS.has(kit)) {
      throw new Error(
        `registry-manifest: "${subpath}" sits in pattern subdirectory "${kit}", which is not in the closed kit set (${[...KITS].join(", ")})`,
      );
    }
    return kit;
  }
  if (displayName.startsWith("Composer")) return "composer";
  if (displayName === "ToastHost" || displayName === "Sonner" || displayName.startsWith("Toast")) return "toast";
  if (displayName.startsWith("Sidebar")) return "sidebar";
  if (displayName.startsWith("Settings")) return "settings";
  return tierId;
}

export function modeFor(displayName) {
  if (SINGLE_MODE_NAMES.has(displayName)) return "single";
  if (COLUMN_MODE_NAMES.has(displayName)) return "column";
  return "grid";
}

/** Newest mtime under the library directory — the registry's whole source of
 * truth, since a dump only records names, subpaths and tiers, all of which are
 * written in these files. */
function newestLibraryMtimeMs(dir = LIBRARY_DIR) {
  let newest = 0;
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, dirent.name);
    const mtime = dirent.isDirectory()
      ? newestLibraryMtimeMs(abs)
      : statSync(abs).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/** Reads the evaluated dump, re-running it when there isn't one or when the
 * library has been edited since the last one was written.
 *
 * build.mjs runs dump-registry.mjs as its own first stage, so a full build
 * always evaluates fresh and this check is a no-op. It exists for the
 * standalone stage runs build.mjs advertises: without it, a stage rerun after
 * a registry edit would silently reuse the previous dump and emit a payload
 * describing a registry that no longer exists (retired entries still carded,
 * new ones missing, group moves stale). */
async function readRegistryDump() {
  const stale =
    existsSync(REGISTRY_JSON_PATH) &&
    statSync(REGISTRY_JSON_PATH).mtimeMs < newestLibraryMtimeMs();
  if (stale) console.log("registry-manifest: library changed since the last dump, re-evaluating");
  if (stale || !existsSync(REGISTRY_JSON_PATH)) await dumpRegistry();
  return JSON.parse(await readFile(REGISTRY_JSON_PATH, "utf8"));
}

/**
 * @returns {Promise<Array<{
 *   name: string, displayName: string, subpath: string, tierId: string,
 *   tierTitle: string, group: string, mode: "grid"|"single"|"column",
 *   primary: string, srcFile: string,
 * }>>}
 */
export async function loadRegistryManifest() {
  const dump = await readRegistryDump();

  const entries = [];
  const seenNames = new Set();
  const tierCounts = new Map();

  for (const { tierId, tierTitle, name, subpath } of dump) {
    if (!TIER_FILES[tierId]) {
      throw new Error(`registry-manifest: entry "${name}" declares unknown tierId "${tierId}"`);
    }
    tierCounts.set(tierId, (tierCounts.get(tierId) ?? 0) + 1);

    // Gate: names key __demos, the preview modules and the card directories,
    // so a collision would silently overwrite a card.
    if (seenNames.has(name)) {
      throw new Error(`registry-manifest: duplicate entry name "${name}" across tiers`);
    }
    seenNames.add(name);

    const displayName = displayNameOf(name);
    if (/[/\s]/.test(displayName)) {
      throw new Error(
        `registry-manifest: "${name}" sanitizes to "${displayName}", which is still unsafe for a path segment`,
      );
    }
    // Gate: every subpath resolves to a real source file.
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
      tierTitle,
      group: groupFor(displayName, tierId, subpath),
      mode,
      primary: mode === "single" ? "Demo" : "",
      srcFile,
    });
  }

  // Gate: exactly the four declared tiers, each non-empty.
  const declaredTiers = Object.keys(TIER_FILES);
  for (const tierId of declaredTiers) {
    if (!tierCounts.get(tierId)) {
      throw new Error(`registry-manifest: tier "${tierId}" contributed no entries`);
    }
  }
  if (tierCounts.size !== declaredTiers.length) {
    throw new Error(
      `registry-manifest: expected exactly ${declaredTiers.length} tiers, got ${tierCounts.size} (${[...tierCounts.keys()].join(", ")})`,
    );
  }

  // Gate: total count. Loud on purpose — the payload's component count is a
  // fact the uploaded README and every consumer's expectations hang off.
  const perTier = declaredTiers.map((t) => `${t}=${tierCounts.get(t)}`).join(" ");
  console.log(`registry-manifest: ${entries.length} entries (${perTier})`);
  if (entries.length !== EXPECTED_TOTAL) {
    throw new Error(
      `registry-manifest: registry has ${entries.length} entries, EXPECTED_TOTAL is ${EXPECTED_TOTAL} (${perTier}).\n` +
        `The library registry changed. If that is intended, bump EXPECTED_TOTAL in scripts/design-sync/registry-manifest.mjs to ${entries.length} and re-sync the payload; if it is not, the registry regressed.`,
    );
  }

  for (const entry of entries) {
    if (!ALLOWED_GROUPS.has(entry.group)) {
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
