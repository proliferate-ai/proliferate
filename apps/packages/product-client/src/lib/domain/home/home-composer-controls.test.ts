import { describe, expect, it, vi } from "vitest";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import {
  buildHomeModelSelectorProps,
  buildHomeSessionConfigControls,
} from "#product/lib/domain/home/home-composer-controls";

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

  it("derives hasAgents from the catalog, not from the observed group list", () => {
    // First run: five agents installing, zero groups. The old
    // `groups.length > 0` reading made the trigger claim "No agents".
    const props = buildHomeModelSelectorProps({
      groups: [],
      selectedModel: null,
      gate: { kind: "blocked", reason: "observation_pending" },
      isCatalogLoading: false,
      hasKnownAgents: true,
      onSelect: vi.fn(),
    });

    expect(props.hasAgents).toBe(true);
    expect(props.isLoading).toBe(false);
    expect(props.availability).toBe("observation_pending");
    expect(props.currentModel).toBeNull();
  });

  it("passes the catalog HTTP load through as isLoading and maps every gate", () => {
    expect(buildHomeModelSelectorProps({
      groups: [],
      selectedModel: null,
      gate: { kind: "blocked", reason: "querying" },
      isCatalogLoading: true,
      hasKnownAgents: false,
      onSelect: vi.fn(),
    }).isLoading).toBe(true);

    expect(buildHomeModelSelectorProps({
      groups: [],
      selectedModel: null,
      gate: { kind: "selection_required" },
      isCatalogLoading: false,
      hasKnownAgents: true,
      onSelect: vi.fn(),
    }).availability).toBe("ready");

    expect(buildHomeModelSelectorProps({
      groups: [],
      selectedModel: null,
      gate: { kind: "blocked", reason: "observed_empty" },
      isCatalogLoading: false,
      hasKnownAgents: true,
      onSelect: vi.fn(),
    }).availability).toBe("observed_empty");
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
