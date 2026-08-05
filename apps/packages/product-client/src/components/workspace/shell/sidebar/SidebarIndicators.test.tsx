// @vitest-environment jsdom

import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CircleAlert } from "#product/primitives/icons/status";
import { Clock } from "#product/primitives/icons/core";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import type { SidebarStatusIndicator } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import { SidebarStatusGlyph } from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import { SidebarWorkspaceGitGlyph } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceGitGlyph";
import type { PrStatusView } from "#product/lib/domain/workspaces/git-status/pr-status-presentation";

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
  const indicator: SidebarStatusIndicator = { kind, tooltip: kind };
  return SidebarStatusGlyph({ indicator });
}

function glyphClassName(node: ReactNode): string {
  if (!isValidElement(node)) {
    return "";
  }
  return String((node.props as { className?: string }).className ?? "");
}

describe("SidebarStatusGlyph", () => {
  it.each(["error", "worktree_missing"] as const)(
    "uses the 12px error treatment for %s",
    (kind) => {
      const glyph = renderGlyph(kind);

      expect(countElementsByType(glyph, CircleAlert)).toBe(1);
      expect(glyphClassName(glyph)).toContain("icon-compact");
      expect(glyphClassName(glyph)).toContain("text-sidebar-status-error");
    },
  );

  it.each(["waiting_input", "waiting_plan"] as const)(
    "uses the 12px waiting clock for %s",
    (kind) => {
      const glyph = renderGlyph(kind);

      expect(countElementsByType(glyph, Clock)).toBe(1);
      expect(countElementsByType(glyph, DotCellLoader)).toBe(0);
      expect(glyphClassName(glyph)).toContain("text-sidebar-status-waiting");
    },
  );

  it.each(["iterating", "queued_prompt"] as const)(
    "uses the compact wave cell for %s",
    (kind) => {
      const glyph = renderGlyph(kind);

      expect(countElementsByType(glyph, DotCellLoader)).toBe(1);
      expect(isValidElement(glyph) ? glyph.props : null).toMatchObject({
        size: "compact",
        variant: "wave",
      });
    },
  );
});

function renderedGlyphMarkup(node: ReactNode): string {
  return renderToStaticMarkup(node as never);
}

describe("SidebarWorkspaceGitGlyph", () => {
  it("renders an open PR as a 14px muted branch glyph with a success dot", () => {
    const markup = renderedGlyphMarkup(
      <SidebarWorkspaceGitGlyph
        glyph={{ conflicted: false, tooltip: null }}
        status={{ kind: "open" } as PrStatusView}
      />,
    );

    expect(markup).toContain("icon-indicator");
    expect(markup).toContain("text-sidebar-muted-foreground");
    expect(markup).toContain("--pr-status-dot-color:var(--color-success)");
    expect(markup).toContain("<circle");
  });

  it("renders a merged PR as the muted merge glyph without a status dot", () => {
    const markup = renderedGlyphMarkup(
      <SidebarWorkspaceGitGlyph
        glyph={{ conflicted: false, tooltip: null }}
        status={{ kind: "merged" } as PrStatusView}
      />,
    );

    expect(markup).toContain("icon-indicator");
    expect(markup).toContain("text-sidebar-muted-foreground");
    expect(markup).not.toContain("--pr-status-dot-color");
  });
});
