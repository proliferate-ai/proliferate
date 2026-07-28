// @vitest-environment jsdom

import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CircleAlert,
  Clock,
  Spinner,
  Tree,
} from "@proliferate/ui/icons";
import type {
  SidebarDetailIndicator,
  SidebarStatusIndicator,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import {
  SidebarDetailIndicatorsView,
  SidebarStatusGlyph,
} from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import { SidebarWorkspaceGitGlyph } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceGitGlyph";
import { SidebarWorkspaceVariantIcon } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import type { PrStatusView } from "@proliferate/product-ui/patterns/PrStatusBadge";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type GlyphTestKind =
  | "error"
  | "worktree_missing"
  | "waiting_input"
  | "waiting_plan"
  | "iterating"
  | "queued_prompt";

function countElementsByType(node: ReactNode, targetType: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((total, child) => total + countElementsByType(child, targetType), 0);
  }

  if (!isValidElement(node)) {
    return 0;
  }

  const props = node.props as { children?: ReactNode };
  return (node.type === targetType ? 1 : 0)
    + countElementsByType(props.children, targetType);
}

function renderGlyph(kind: GlyphTestKind): ReactNode {
  const indicator: SidebarStatusIndicator = {
    kind,
    tooltip: kind,
  };

  return SidebarStatusGlyph({
    indicator,
  });
}

function glyphClassName(node: ReactNode): string {
  if (!isValidElement(node)) {
    return "";
  }
  return String((node.props as { className?: string }).className ?? "");
}

describe("SidebarStatusGlyph", () => {

  it.each(["error", "worktree_missing"] as const)(
    "uses the indicator tier for the %s warning glyph",
    (kind) => {
      const glyph = renderGlyph(kind);

      expect(countElementsByType(glyph, CircleAlert)).toBe(1);
      expect(glyphClassName(glyph)).toContain("icon-indicator");
    },
  );

  it("keeps user-input blockers visually distinct from progress", () => {
    const glyph = renderGlyph("waiting_input");

    expect(countElementsByType(glyph, Clock)).toBe(1);
    expect(countElementsByType(glyph, Spinner)).toBe(0);
    expect(glyphClassName(glyph)).toContain("icon-indicator");
  });

  it("keeps plan-approval blockers visually distinct from progress", () => {
    const glyph = renderGlyph("waiting_plan");

    expect(countElementsByType(glyph, Clock)).toBe(1);
    expect(countElementsByType(glyph, Spinner)).toBe(0);
    expect(glyphClassName(glyph)).toContain("icon-indicator");
  });

  it("uses a progress glyph for active work", () => {
    const glyph = renderGlyph("iterating");

    expect(countElementsByType(glyph, Spinner)).toBe(1);
    expect(glyphClassName(glyph)).toContain("icon-indicator");
  });

  it("uses a progress glyph for queued prompts", () => {
    const glyph = renderGlyph("queued_prompt");

    expect(countElementsByType(glyph, Spinner)).toBe(1);
    expect(glyphClassName(glyph)).toContain("icon-indicator");
  });
});

describe("SidebarWorkspaceVariantIcon", () => {
  it("uses the Home worktree glyph in sidebar surfaces", () => {
    const glyph = SidebarWorkspaceVariantIcon({ variant: "worktree" });

    expect(isValidElement(glyph)).toBe(true);
    expect(isValidElement(glyph) ? glyph.type : null).toBe(Tree);
  });
});

/**
 * Class lists of every `<svg>` in a statically rendered tree. Static markup
 * rather than a jsdom mount: these assertions only need the class the component
 * chose, and this file's suite is cheap enough to stay that way.
 */
function renderedGlyphClasses(node: ReactNode): string[] {
  return Array.from(
    renderToStaticMarkup(node as never).matchAll(/<svg[^>]*\sclass="([^"]*)"/g),
  ).map((match) => match[1] ?? "");
}

describe("sidebar detail cluster glyph tier", () => {
  // The trailing cluster is metadata about the row, so it renders one tier
  // BELOW the row's own text (`icon-tight` = 0.875em against
  // --text-sidebar-row) and the workspace name leads. Pinned as a test because
  // the regression is purely optical: nothing breaks when a glyph drifts back
  // up to the row-text tier, it just starts competing with the name.
  const TIER_CLASS = "icon-tight";

  it.each([
    {
      label: "materialization",
      indicator: {
        kind: "materialization",
        variant: "worktree",
        tooltip: "Worktree",
      },
    },
    {
      label: "cloud access",
      indicator: { kind: "cloud_access", tone: "neutral", tooltip: "Access" },
    },
    {
      label: "cloud exposure",
      indicator: { kind: "cloud_exposure", tone: "neutral", tooltip: "Exposure" },
    },
    {
      label: "automation",
      indicator: { kind: "automation", tooltip: "Automation" },
    },
    { label: "agent", indicator: { kind: "agent", tooltip: "Agent" } },
    { label: "origin", indicator: { kind: "origin", tooltip: "Origin" } },
  ] as { label: string; indicator: SidebarDetailIndicator }[])(
    "draws the $label glyph one tier below the row text",
    ({ indicator }) => {
      const classes = renderedGlyphClasses(
        <SidebarDetailIndicatorsView indicators={[indicator]} />,
      );

      expect(classes.length).toBeGreaterThan(0);
      for (const className of classes) {
        expect(className).toContain(TIER_CLASS);
        expect(className).not.toContain("icon-compact");
        expect(className).not.toContain("icon-paired");
      }
    },
  );

  it("shrinks the artwork of an actionable glyph without shrinking its target", () => {
    // The visible SVG drops a tier; the button that owns the pointer target
    // keeps its own box (`!size-4`, which beats IconButton's own `size-6`), so
    // the hit area is exactly what it was before the artwork shrank.
    const markup = renderToStaticMarkup(
      <SidebarDetailIndicatorsView
        indicators={[{
          kind: "agent",
          tooltip: "Open source session",
          action: { kind: "open_source_session", workspaceId: "w1", sessionId: "s1" },
        }]}
        onAction={() => undefined}
      />,
    );

    expect(markup).toContain("!size-4");
    expect(markup).toContain(TIER_CLASS);
  });
});

describe("SidebarWorkspaceGitGlyph", () => {
  it.each([
    { label: "an open PR", kind: "open" as const },
    { label: "a merged PR", kind: "merged" as const },
  ])("draws the git glyph for $label one tier below the row text", ({ kind }) => {
    const [className = ""] = renderedGlyphClasses(
      <SidebarWorkspaceGitGlyph
        glyph={{ conflicted: false, tooltip: null }}
        status={{ kind } as PrStatusView}
      />,
    );

    expect(className).toContain("icon-tight");
    expect(className).not.toContain("icon-paired");
    // Still em-relative against the row's own text token — never a pixel size.
    expect(className).toContain("[font-size:var(--text-sidebar-row)]");
  });
});
