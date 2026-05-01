import { describe, expect, it } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { WorkspaceMobilityOverlayView } from "./WorkspaceMobilityOverlay";
import { CheckCircleFilled, CircleAlert } from "@/components/ui/icons";

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

describe("WorkspaceMobilityOverlayView", () => {
  it("keeps completion as a notice overlay", () => {
    const element = WorkspaceMobilityOverlayView({
      description: "This workspace has moved to the cloud.",
      mcpNotice: "Reconnect MCP tools in cloud.",
      mode: "completion",
      title: "Now in cloud",
    });

    expect(countElementsByType(element, CheckCircleFilled)).toBe(1);
  });

  it("keeps cleanup failure as a recovery overlay", () => {
    const element = WorkspaceMobilityOverlayView({
      description: "The workspace moved, but cleanup needs retry.",
      mode: "cleanup_failed",
      title: "Cleanup needs retry",
    });

    expect(countElementsByType(element, CircleAlert)).toBe(1);
  });
});
