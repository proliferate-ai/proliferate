/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoworkArtifactsPanel } from "#product/components/workspace/cowork/CoworkArtifactsPanel";

const artifactState = vi.hoisted(() => ({
  artifacts: [] as Array<{ id: string; description?: string | null }>,
  isLoading: false,
  isFetching: false,
  refresh: vi.fn(async () => undefined),
  selectedArtifactId: null as string | null,
  setSelectedArtifactId: vi.fn(),
}));

vi.mock("@proliferate/ui/layout/AutoHideScrollArea", () => ({
  AutoHideScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("#product/hooks/access/anyharness/cowork/use-cowork-artifact-manifest", () => ({
  useCoworkArtifactManifest: () => ({
    artifacts: artifactState.artifacts,
    isLoading: artifactState.isLoading,
    isFetching: artifactState.isFetching,
  }),
}));

vi.mock("#product/hooks/access/anyharness/cowork/use-cowork-artifact-detail", () => ({
  useCoworkArtifactDetail: () => ({
    artifactDetail: null,
    isLoading: false,
    isFetching: false,
    errorMessage: null,
  }),
}));

vi.mock("#product/hooks/cowork/lifecycle/use-cowork-artifact-refresh", () => ({
  useCoworkArtifactRefresh: () => ({ refresh: artifactState.refresh }),
}));

vi.mock("#product/stores/cowork/cowork-ui-store", () => ({
  useCoworkUiStore: (selector: (state: {
    selectedArtifactIdByWorkspaceId: Record<string, string | null>;
    setSelectedArtifactId: typeof artifactState.setSelectedArtifactId;
  }) => unknown) => selector({
    selectedArtifactIdByWorkspaceId: {
      "workspace-cowork": artifactState.selectedArtifactId,
    },
    setSelectedArtifactId: artifactState.setSelectedArtifactId,
  }),
}));

vi.mock("#product/components/workspace/cowork/CoworkArtifactRow", () => ({
  CoworkArtifactRow: ({ artifact }: { artifact: { id: string } }) => <div>{artifact.id}</div>,
}));

vi.mock("#product/components/workspace/cowork/CoworkArtifactViewer", () => ({
  CoworkArtifactViewer: () => <div>Artifact viewer</div>,
}));

afterEach(() => {
  cleanup();
  artifactState.artifacts = [];
  artifactState.isLoading = false;
  artifactState.isFetching = false;
  artifactState.selectedArtifactId = null;
  artifactState.refresh.mockClear();
  artifactState.setSelectedArtifactId.mockClear();
});

describe("CoworkArtifactsPanel", () => {
  it("renders an intentional empty state with a single refresh action", () => {
    const { container } = render(<CoworkArtifactsPanel workspaceId="workspace-cowork" />);

    expect(screen.getByRole("heading", { name: "No artifacts yet" })).toBeTruthy();
    expect(screen.getByText("Artifacts created by this thread will appear here.")).toBeTruthy();
    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    expect(refreshButtons).toHaveLength(1);
    expect(container.querySelector(".border-dashed")).not.toBeNull();

    fireEvent.click(refreshButtons[0]!);
    expect(artifactState.refresh).toHaveBeenCalledTimes(1);
  });
});
