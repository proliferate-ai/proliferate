import { describe, expect, it, vi } from "vitest";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import {
  buildHomeModeControlDescriptor,
  buildHomeSessionConfigControls,
} from "./home-composer-controls";

const CODEX_ACCESS_MODES = [
  {
    value: "auto",
    label: "Auto",
    icon: "edit" as const,
    isDefault: true,
  },
  {
    value: "full-access",
    label: "Full Access",
    icon: "zap" as const,
  },
];

describe("home composer controls", () => {
  it("uses the supplied access label without changing create-time mode semantics", () => {
    const descriptor = buildHomeModeControlDescriptor({
      modes: CODEX_ACCESS_MODES,
      selectedModeId: "auto",
      label: "Permissions",
      onSelect: vi.fn(),
    });

    expect(descriptor).toMatchObject({
      key: "mode",
      rawConfigId: "mode",
      label: "Permissions",
      options: [
        { value: "auto", selected: true },
        { value: "full-access", selected: false },
      ],
    });
  });

  it("keeps Codex collaboration and access controls independent for repository launches", () => {
    const collaborationMode = descriptor({
      key: "collaboration_mode",
      label: "Collaboration Mode",
      options: [
        { value: "default", label: "Default", selected: true },
        { value: "plan", label: "Plan", selected: false },
      ],
    });

    expect(buildHomeSessionConfigControls({
      destination: "repository",
      agentKind: "codex",
      modes: CODEX_ACCESS_MODES,
      selectedModeId: "auto",
      launchControls: [collaborationMode],
      onSelectMode: vi.fn(),
    })).toMatchObject([
      {
        key: "mode",
        label: "Permissions",
        options: [
          { value: "auto", selected: true },
          { value: "full-access", selected: false },
        ],
      },
      {
        key: "collaboration_mode",
        options: [
          { value: "default", selected: true },
          { value: "plan", selected: false },
        ],
      },
    ]);
  });

  it("labels Codex access mode as permissions before collaboration mode is available", () => {
    expect(buildHomeSessionConfigControls({
      destination: "repository",
      agentKind: "codex",
      modes: CODEX_ACCESS_MODES,
      selectedModeId: "auto",
      launchControls: [],
      onSelectMode: vi.fn(),
    })).toMatchObject([
      {
        key: "mode",
        label: "Permissions",
      },
    ]);
  });

  it("hides Cowork permission mode while retaining independent collaboration mode", () => {
    const collaborationMode = descriptor({
      key: "collaboration_mode",
      label: "Collaboration Mode",
    });
    const permissionMode = descriptor({ key: "mode", label: "Permissions" });
    const effort = descriptor({ key: "effort", label: "Reasoning effort" });

    expect(buildHomeSessionConfigControls({
      destination: "cowork",
      agentKind: "codex",
      modes: CODEX_ACCESS_MODES,
      selectedModeId: "auto",
      launchControls: [collaborationMode, permissionMode, effort],
      onSelectMode: vi.fn(),
    })).toEqual([collaborationMode, effort]);
  });
});

function descriptor({
  key,
  label,
  options = [],
}: {
  key: LiveSessionControlDescriptor["key"];
  label: string;
  options?: LiveSessionControlDescriptor["options"];
}): LiveSessionControlDescriptor {
  return {
    key,
    label,
    detail: null,
    rawConfigId: key,
    settable: true,
    pendingState: null,
    kind: "select",
    options,
    onSelect: vi.fn(),
  };
}
