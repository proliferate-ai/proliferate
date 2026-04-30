import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  CircleQuestion,
  ClipboardList,
  Spinner,
} from "@/components/ui/icons";
import type { SidebarStatusIndicator } from "@/lib/domain/workspaces/sidebar";
import { SidebarStatusGlyph } from "./SidebarIndicators";

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
