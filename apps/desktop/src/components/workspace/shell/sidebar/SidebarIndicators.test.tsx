// @vitest-environment jsdom

import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  Clock,
  Spinner,
} from "@proliferate/ui/icons";
import type { SidebarStatusIndicator } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import {
  SidebarStatusGlyph,
} from "./SidebarIndicators";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type GlyphTestKind =
  | "waiting_input"
  | "waiting_plan"
  | "iterating"
  | "queued_prompt"
  | "needs_review";

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

    expect(countElementsByType(glyph, Clock)).toBe(1);
    expect(countElementsByType(glyph, Spinner)).toBe(0);
  });

  it("keeps plan-approval blockers visually distinct from progress", () => {
    const glyph = renderGlyph("waiting_plan");

    expect(countElementsByType(glyph, Clock)).toBe(1);
    expect(countElementsByType(glyph, Spinner)).toBe(0);
  });

  it("uses a progress glyph for active work", () => {
    const glyph = renderGlyph("iterating");

    expect(countElementsByType(glyph, Spinner)).toBe(1);
  });

  it("uses a progress glyph for queued prompts", () => {
    const glyph = renderGlyph("queued_prompt");

    expect(countElementsByType(glyph, Spinner)).toBe(1);
  });

  it("uses an unread dot for needs-review work", () => {
    const glyph = renderGlyph("needs_review");

    expect(countElementsByType(glyph, Clock)).toBe(0);
    expect(countElementsByType(glyph, "span")).toBe(1);
  });
});
