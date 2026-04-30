import { describe, expect, it } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { WorkspaceMobilityOverlayView } from "./WorkspaceMobilityOverlay";
import { CloudIcon, FolderOpen, LoaderCircle } from "@/components/ui/icons";

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
  it("uses the status pill as the only progress spinner", () => {
    const element = WorkspaceMobilityOverlayView({
      description: "Moving workspace state to the new runtime.",
      direction: "local_to_cloud",
      locationLabel: "Cloud workspace",
      mode: "progress",
      statusLabel: "Syncing workspace",
      title: "Moving to cloud",
    });

    expect(countElementsByType(element, LoaderCircle)).toBe(1);
  });

  it("uses a static cloud hero icon for local to cloud progress", () => {
    const element = WorkspaceMobilityOverlayView({
      description: null,
      direction: "local_to_cloud",
      locationLabel: "Cloud workspace",
      mode: "progress",
      statusLabel: "Preparing cloud workspace",
      title: "Moving to cloud",
    });

    expect(countElementsByType(element, CloudIcon)).toBe(1);
    expect(countElementsByType(element, FolderOpen)).toBe(0);
  });

  it("uses a static folder hero icon for cloud to local progress", () => {
    const element = WorkspaceMobilityOverlayView({
      description: null,
      direction: "cloud_to_local",
      locationLabel: "Local workspace",
      mode: "progress",
      statusLabel: "Preparing local workspace",
      title: "Bringing back local",
    });

    expect(countElementsByType(element, FolderOpen)).toBe(1);
    expect(countElementsByType(element, CloudIcon)).toBe(0);
  });
});
