// @vitest-environment jsdom

import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CircleAlert } from "#product/primitives/icons/status";
import { Clock } from "#product/primitives/icons/core";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import {
  SIDEBAR_GIT_CONFLICTS_LABEL,
  type SidebarStatusIndicator,
  type SidebarWorkspaceVariant,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import {
  SidebarStatusGlyph,
  SidebarStatusIndicatorView,
} from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import { SidebarWorkspaceGitGlyph } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceGitGlyph";
import { resolveSidebarWorkspaceGitIdentity } from "#product/lib/domain/workspaces/git-status/sidebar-git-identity";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type GlyphTestKind =
  | "error"
  | "worktree_missing"
  | "waiting_input"
  | "waiting_plan"
  | "iterating"
  | "queued_prompt"
  | "git_conflicts"
  | "git_checks_failing"
  | "git_changes_requested";

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
    "uses the quiet 12px waiting clock for %s",
    (kind) => {
      const glyph = renderGlyph(kind);

      expect(countElementsByType(glyph, Clock)).toBe(1);
      expect(countElementsByType(glyph, DotCellLoader)).toBe(0);
      expect(glyphClassName(glyph)).toContain("icon-compact");
      // Waiting is a resting state: it reads in the muted row ink, not in the
      // status ink the error and conflict alerts keep.
      expect(glyphClassName(glyph)).toContain("text-sidebar-muted-foreground");
      expect(glyphClassName(glyph)).not.toContain("text-sidebar-status-waiting");
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

/**
 * The row's real path: resolve the identity once, and render the glyph only
 * when there is one. An empty string therefore means the cell collapsed.
 */
function renderedIdentityMarkup(
  status: WorkspaceGitStatus | null,
  variant: SidebarWorkspaceVariant,
): string {
  const identity = resolveSidebarWorkspaceGitIdentity(status, variant);
  return identity
    ? renderedGlyphMarkup(<SidebarWorkspaceGitGlyph identity={identity} />)
    : "";
}

describe("SidebarWorkspaceGitGlyph", () => {
  const status = (overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus => ({
    branch: "feature/sidebar",
    dirty: false,
    conflicted: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    pr: {
      state: "open",
      number: 805,
      url: "https://github.com/acme/repo/pull/805",
      checks: "none",
      reviewDecision: "none",
    },
    attention: "none",
    capturedAt: "2026-08-04T00:00:00.000Z",
    source: "live",
    ...overrides,
  });

  const prStatus = (
    overrides: Partial<WorkspaceGitStatus["pr"] & object>,
  ): WorkspaceGitStatus => status({
    pr: {
      state: "open",
      number: 805,
      url: "https://github.com/acme/repo/pull/805",
      checks: "none",
      reviewDecision: "none",
      ...overrides,
    },
  });

  it.each([
    ["open", {}, "text-success", "solid"],
    ["checks pending", { checks: "pending" }, "text-warning-foreground", "hollow"],
    ["checks failing", { checks: "failing" }, "text-destructive", "solid"],
    [
      "changes requested",
      { reviewDecision: "changes_requested" },
      "text-warning-foreground",
      "solid",
    ],
    ["draft", { state: "draft" }, "text-muted-foreground", "solid"],
    ["closed", { state: "closed" }, "text-destructive", "solid"],
  ] as const)(
    "colours the state dot for a %s pull request",
    (_name, overrides, toneClass, fill) => {
      const identity = resolveSidebarWorkspaceGitIdentity(
        prStatus(overrides),
        "worktree",
      );

      expect(identity).toMatchObject({ kind: "pull_request", fill });

      const markup = renderedIdentityMarkup(prStatus(overrides), "worktree");
      // The branch strokes stay on the row's muted ink; only the standalone
      // bottom-right dot carries the state.
      expect(markup).toContain("text-sidebar-muted-foreground");
      // Assert on the dot circle itself: the SVG root carries its own
      // fill="none", so a looser match would pass for either fill.
      expect(markup).toContain(
        `<circle class="${toneClass}" cx="15" cy="15" r="3" fill="${
          fill === "hollow" ? "none" : "currentColor"
        }" stroke="currentColor"`,
      );
      // The construction itself, not just the dot: the branch column and the
      // hook arrow are the glyph's identity, and a redraw that loses them
      // would still satisfy every dot assertion above.
      expect(markup).toContain('d="M5.4165 6.66664V13.3333"');
      expect(markup).toContain('d="M8.55 4.35H11.9C13.03 4.35 13.95 5.27 13.95 6.4V9.2"');
    },
  );

  it("renders a merged pull request as the whole glyph in the merged ink", () => {
    const merged = prStatus({ state: "merged" });

    expect(resolveSidebarWorkspaceGitIdentity(merged, "worktree"))
      .toMatchObject({ kind: "merged_pull_request" });

    const markup = renderedIdentityMarkup(merged, "worktree");

    expect(markup).toContain("text-sidebar-status-worktree");
    expect(markup).toContain("PR #805 · Merged");
    // Merged is settled: the whole glyph is the signal, so there is no dot.
    expect(markup).not.toContain('cy="15" r="3"');
  });

  it("keeps the row's own topology as the identity when there is no PR", () => {
    const noPr = status({
      pr: { state: "none", number: null, url: null, checks: "none", reviewDecision: "none" },
    });

    expect(resolveSidebarWorkspaceGitIdentity(noPr, "worktree"))
      .toEqual({ kind: "worktree" });
    expect(resolveSidebarWorkspaceGitIdentity(noPr, "cloud"))
      .toEqual({ kind: "cloud" });

    expect(renderedIdentityMarkup(noPr, "worktree")).toContain("rotate-90");
    expect(renderedIdentityMarkup(noPr, "cloud"))
      .toContain("Cloud workspace · no pull request");
  });

  it("falls back to topology when PR data is unknown rather than absent", () => {
    expect(resolveSidebarWorkspaceGitIdentity(status({ pr: null }), "worktree"))
      .toEqual({ kind: "worktree" });
    expect(resolveSidebarWorkspaceGitIdentity(null, "cloud"))
      .toEqual({ kind: "cloud" });
  });

  it.each(["local"] as const)(
    "renders no identity at all for a %s row without a PR",
    (variant) => {
      expect(resolveSidebarWorkspaceGitIdentity(null, variant)).toBeNull();
      expect(renderedIdentityMarkup(null, variant)).toBe("");
    },
  );

  it("leaves check and review attention to the state dot alone", () => {
    const markup = renderedIdentityMarkup(prStatus({ checks: "failing" }), "worktree");

    // The old separate alert beside the glyph said the same thing the dot
    // already says.
    expect(markup).not.toContain("text-sidebar-status-waiting");
    expect(markup).not.toContain("Pull request checks failing");
  });
});

describe("git attention in the status cell", () => {
  it("keeps conflicts as an alert in the row's status cell", () => {
    const markup = renderedGlyphMarkup(
      <SidebarStatusIndicatorView
        indicator={{ kind: "git_conflicts", tooltip: SIDEBAR_GIT_CONFLICTS_LABEL }}
      />,
    );

    expect(markup).toContain("text-sidebar-status-waiting");
    expect(markup).toContain(SIDEBAR_GIT_CONFLICTS_LABEL);
    // Same fixed cell as the activity indicators it sits in place of.
    expect(markup).toContain("h-5 min-w-5");
  });

  it("gives failing checks the error ink and requested changes the waiting ink", () => {
    expect(glyphClassName(renderGlyph("git_checks_failing")))
      .toContain("text-sidebar-status-error");
    expect(glyphClassName(renderGlyph("git_changes_requested")))
      .toContain("text-sidebar-status-waiting");
    expect(countElementsByType(renderGlyph("git_checks_failing"), CircleAlert)).toBe(1);
    expect(countElementsByType(renderGlyph("git_changes_requested"), CircleAlert)).toBe(1);
  });
});
