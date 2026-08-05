import { describe, expect, it } from "vitest";
import uiPackageJson from "../../../../../ui/package.json";
import { LIBRARY_TIERS } from "./index";

/**
 * Drift gate: the component-library spec sheet must cover exactly the
 * sanctioned component surface. Reads UI's real `package.json` exports and
 * inventories the ProductClient domain-aware pattern owners, then diffs both
 * against the registry that powers `/playground/library`.
 */

type ExportsMap = Record<string, unknown>;

function subpathsWithPrefix(exportsMap: ExportsMap, prefixes: string[]): string[] {
  return Object.keys(exportsMap).filter((subpath) =>
    prefixes.some((prefix) => subpath.startsWith(prefix)));
}

function toPackageSubpath(packageName: string, subpath: string): string {
  // exports keys are "./primitives/Button" — join with the package name the
  // registry actually imports through ("@proliferate/ui/primitives/Button").
  return `${packageName}/${subpath.replace(/^\.\//, "")}`;
}

const uiExports = (uiPackageJson as { exports: ExportsMap }).exports;
const productPatternModules = import.meta.glob([
  "../../patterns/*.tsx",
  "../../patterns/secrets/SecretManagementPanel.tsx",
  "!../../patterns/*.test.tsx",
]);

// Same tiers as the design-system contract: ui/src ships exported
// primitives/patterns/icons; ProductClient owns the domain-aware fourth tier.
const EXPECTED_UI_SUBPATHS = new Set(
  subpathsWithPrefix(uiExports, ["./primitives/", "./patterns/", "./icons"])
    .map((subpath) => toPackageSubpath("@proliferate/ui", subpath)),
);
const EXPECTED_PRODUCT_PATTERN_SUBPATHS = new Set(
  Object.keys(productPatternModules).map((modulePath) =>
    `#product/components/patterns/${modulePath
      .replace(/^\.\.\/\.\.\/patterns\//, "")
      .replace(/\.tsx$/, "")}`),
);
const EXPECTED_SUBPATHS = new Set([
  ...EXPECTED_UI_SUBPATHS,
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
  it("covers exactly the sanctioned UI exports and ProductClient pattern owners", () => {
    const registered = new Set(registrySubpaths());

    const missing = [...EXPECTED_SUBPATHS].filter((subpath) => !registered.has(subpath));
    const unknown = [...registered].filter((subpath) => !EXPECTED_SUBPATHS.has(subpath));

    expect(
      missing.length === 0,
      `sanctioned exports with no library-sheet entry:\n${formatList(missing)}`,
    ).toBe(true);
    expect(
      unknown.length === 0,
      `library-sheet entries for a subpath that is not a sanctioned export:\n${formatList(unknown)}`,
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

  it("keeps every tier's entries scoped to that tier's expected prefix set", () => {
    const tierExpectations: Record<string, Set<string>> = {
      primitives: new Set(
        subpathsWithPrefix(uiExports, ["./primitives/"]).map((subpath) =>
          toPackageSubpath("@proliferate/ui", subpath)),
      ),
      patterns: new Set(
        subpathsWithPrefix(uiExports, ["./patterns/"]).map((subpath) =>
          toPackageSubpath("@proliferate/ui", subpath)),
      ),
      icons: new Set(
        subpathsWithPrefix(uiExports, ["./icons"]).map((subpath) =>
          toPackageSubpath("@proliferate/ui", subpath)),
      ),
      "product-patterns": EXPECTED_PRODUCT_PATTERN_SUBPATHS,
    };

    for (const tier of LIBRARY_TIERS) {
      const expected = tierExpectations[tier.id];
      expect(expected, `unknown tier id in registry: ${tier.id}`).toBeDefined();
      const actual = new Set(tier.entries.map((entry) => entry.subpath));
      expect(
        [...actual].sort(),
        `tier "${tier.id}" entries do not match its expected export subset`,
      ).toEqual([...(expected as Set<string>)].sort());
    }
  });
});
