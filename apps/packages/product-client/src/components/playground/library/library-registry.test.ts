import { describe, expect, it } from "vitest";
import { LIBRARY_TIERS } from "./index";

/**
 * Drift gate: the component-library spec sheet must cover exactly the
 * renderable ProductClient primitive, pattern, icon, and product-pattern
 * owners. Physical inventories keep this assertion independent of a package
 * manifest or an aggregate export barrel.
 */

type ModuleInventory = Record<string, unknown>;

/**
 * Derive canonical subpaths from the tier-relative path, not the basename:
 * `patterns/` holds area-kit subdirectories (`composer/`, `toast/`,
 * `sidebar/`, `settings/`, `panel/`, `tabs/`), so a nested member's subpath
 * keeps its kit segment.
 */
function inventorySubpaths(
  modules: ModuleInventory,
  canonicalPrefix: string,
  tierGlobPrefix: string,
): Set<string> {
  return new Set(
    Object.keys(modules).map((modulePath) => {
      if (!modulePath.startsWith(tierGlobPrefix) || !modulePath.endsWith(".tsx")) {
        throw new Error(`unexpected library inventory path: ${modulePath}`);
      }
      const tierRelative = modulePath.slice(tierGlobPrefix.length, -".tsx".length);
      return `${canonicalPrefix}/${tierRelative}`;
    }),
  );
}

const primitiveModules = import.meta.glob([
  "../../../primitives/*.tsx",
  "!../../../primitives/*.test.tsx",
]);
const patternModules = import.meta.glob([
  "../../../primitives/patterns/**/*.tsx",
  "!../../../primitives/patterns/**/*.test.tsx",
  "!../../../primitives/patterns/toast/ToastBody.tsx",
  "!../../../primitives/patterns/toast/ToastExpansion.tsx",
]);
const iconModules = import.meta.glob("../../../primitives/icons/*.tsx");
const productPatternModules = import.meta.glob([
  "../../patterns/*.tsx",
  "../../patterns/secrets/SecretManagementPanel.tsx",
  "!../../patterns/*.test.tsx",
]);

const EXPECTED_PRIMITIVE_SUBPATHS = inventorySubpaths(
  primitiveModules,
  "#product/primitives",
  "../../../primitives/",
);
const EXPECTED_PATTERN_SUBPATHS = inventorySubpaths(
  patternModules,
  "#product/primitives/patterns",
  "../../../primitives/patterns/",
);
const EXPECTED_ICON_SUBPATHS = inventorySubpaths(
  iconModules,
  "#product/primitives/icons",
  "../../../primitives/icons/",
);
const EXPECTED_PRODUCT_PATTERN_SUBPATHS = inventorySubpaths(
  productPatternModules,
  "#product/components/patterns",
  "../../patterns/",
);
const EXPECTED_SUBPATHS = new Set([
  ...EXPECTED_PRIMITIVE_SUBPATHS,
  ...EXPECTED_PATTERN_SUBPATHS,
  ...EXPECTED_ICON_SUBPATHS,
  ...EXPECTED_PRODUCT_PATTERN_SUBPATHS,
]);

function registrySubpaths(): string[] {
  return LIBRARY_TIERS.flatMap((tier) => tier.entries.map((entry) => entry.subpath));
}

function formatList(subpaths: Iterable<string>): string {
  const sorted = [...subpaths].sort();
  return sorted.length === 0 ? "(none)" : sorted.map((subpath) => `  - ${subpath}`).join("\n");
}

describe("library registry parity", () => {
  it("inventories the expected physical primitive surface", () => {
    expect({
      primitives: EXPECTED_PRIMITIVE_SUBPATHS.size,
      patterns: EXPECTED_PATTERN_SUBPATHS.size,
      icons: EXPECTED_ICON_SUBPATHS.size,
      total:
        EXPECTED_PRIMITIVE_SUBPATHS.size
        + EXPECTED_PATTERN_SUBPATHS.size
        + EXPECTED_ICON_SUBPATHS.size,
    }).toEqual({ primitives: 38, patterns: 37, icons: 10, total: 85 });
  });

  it("covers exactly the physical primitive surface and ProductClient pattern owners", () => {
    const registered = new Set(registrySubpaths());

    const missing = [...EXPECTED_SUBPATHS].filter((subpath) => !registered.has(subpath));
    const unknown = [...registered].filter((subpath) => !EXPECTED_SUBPATHS.has(subpath));

    expect(
      missing.length === 0,
      `physical owners with no library-sheet entry:\n${formatList(missing)}`,
    ).toBe(true);
    expect(
      unknown.length === 0,
      `library-sheet entries without a physical owner:\n${formatList(unknown)}`,
    ).toBe(true);
  });

  it("declares no duplicate subpath across tiers", () => {
    const subpaths = registrySubpaths();
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const subpath of subpaths) {
      if (seen.has(subpath)) {
        duplicates.push(subpath);
      }
      seen.add(subpath);
    }
    expect(duplicates, `duplicate registry entries:\n${formatList(duplicates)}`).toEqual([]);
  });

  it("keeps every tier's entries equal to that tier's physical inventory", () => {
    const tierExpectations: Record<string, Set<string>> = {
      primitives: EXPECTED_PRIMITIVE_SUBPATHS,
      patterns: EXPECTED_PATTERN_SUBPATHS,
      icons: EXPECTED_ICON_SUBPATHS,
      "product-patterns": EXPECTED_PRODUCT_PATTERN_SUBPATHS,
    };

    for (const tier of LIBRARY_TIERS) {
      const expected = tierExpectations[tier.id];
      expect(expected, `unknown tier id in registry: ${tier.id}`).toBeDefined();
      const actual = new Set(tier.entries.map((entry) => entry.subpath));
      expect(
        [...actual].sort(),
        `tier "${tier.id}" entries do not match its physical inventory`,
      ).toEqual([...(expected as Set<string>)].sort());
    }
  });
});
