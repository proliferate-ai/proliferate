// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralPane } from "#product/components/settings/panes/GeneralPane";

vi.mock("#product/hooks/access/tauri/shell/use-available-editors", () => ({
  useAvailableEditors: () => ({ data: [] }),
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    defaultOpenInTargetId: "",
    branchPrefixType: "none",
    turnEndSoundEnabled: false,
    coworkWorkspaceDelegationEnabled: true,
    pasteAttachmentsEnabled: true,
    autoUpdateEnabled: false,
    set: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("GeneralPane session policy", () => {
  it("does not present the compatibility-only subagents flag as current Workspace authority", () => {
    render(<GeneralPane />);

    expect(screen.queryByText("Allow coding agents to spin up subagents")).toBeNull();
    expect(screen.queryByText(/saved delegation policy/i)).toBeNull();
    expect(screen.getByText("Allow cowork agents to create coding workspaces")).not.toBeNull();
  });
});
