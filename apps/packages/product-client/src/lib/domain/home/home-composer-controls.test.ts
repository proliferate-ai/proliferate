import { describe, expect, it, vi } from "vitest";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { buildHomeSessionConfigControls } from "#product/lib/domain/home/home-composer-controls";

describe("home composer controls", () => {
  it("preserves every target-observed control without singleton mode handling", () => {
    const access = descriptor({ key: "mode", label: "Access" });
    const collaboration = descriptor({
      key: "collaboration_mode",
      label: "Collaboration",
    });
    const unknown = descriptor({ key: "unknown", label: "New upstream control" });

    expect(buildHomeSessionConfigControls({
      launchControls: [access, collaboration, unknown],
    })).toEqual([access, collaboration, unknown]);
  });
});

function descriptor({
  key,
  label,
}: {
  key: string;
  label: string;
}): LiveSessionControlDescriptor {
  return {
    key: key as LiveSessionControlDescriptor["key"],
    label,
    detail: null,
    rawConfigId: key,
    settable: true,
    pendingState: null,
    kind: "select",
    options: [],
    onSelect: vi.fn(),
  };
}
