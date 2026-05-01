// @vitest-environment jsdom

import { act, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  CircleQuestion,
  ClipboardList,
  Spinner,
} from "@/components/ui/icons";
import type {
  SidebarDetailIndicator,
  SidebarIndicatorAction,
  SidebarStatusIndicator,
} from "@/lib/domain/workspaces/sidebar";
import {
  SidebarDetailIndicatorsView,
  SidebarStatusGlyph,
} from "./SidebarIndicators";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type GlyphTestKind = "waiting_input" | "waiting_plan" | "iterating";

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

describe("SidebarStatusGlyph", () => {
  it("keeps user-input blockers visually distinct from progress", () => {
    const glyph = renderGlyph("waiting_input");

    expect(countElementsByType(glyph, CircleQuestion)).toBe(1);
    expect(countElementsByType(glyph, Spinner)).toBe(0);
  });

  it("keeps plan-approval blockers visually distinct from progress", () => {
    const glyph = renderGlyph("waiting_plan");

    expect(countElementsByType(glyph, ClipboardList)).toBe(1);
    expect(countElementsByType(glyph, Spinner)).toBe(0);
  });

  it("keeps iteration as the only progress glyph in active sidebar statuses", () => {
    const glyph = renderGlyph("iterating");

    expect(countElementsByType(glyph, Spinner)).toBe(1);
  });
});

describe("SidebarDetailIndicatorsView", () => {
  it("opens finish suggestion actions from the merge indicator", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actions: SidebarIndicatorAction[] = [];
    const indicator: SidebarDetailIndicator = {
      kind: "finish_suggestion",
      tooltip: "Ready to mark done",
      workspaceId: "workspace-1",
      logicalWorkspaceId: "path:/repo",
      readinessFingerprint: "fingerprint-1",
    };

    act(() => {
      root.render(
        <SidebarDetailIndicatorsView
          indicators={[indicator]}
          onAction={(action) => actions.push(action)}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Ready to mark done"]',
    );
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(findButtonByText("Mark done")).not.toBeNull();
    const keepActive = findButtonByText("Keep active");
    expect(keepActive).not.toBeNull();

    act(() => {
      keepActive?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(actions).toEqual([
      {
        kind: "keep_workspace_active",
        workspaceId: "workspace-1",
        readinessFingerprint: "fingerprint-1",
      },
    ]);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

function findButtonByText(text: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === text) ?? null;
}
