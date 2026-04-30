import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepoSetupModalHost } from "./RepoSetupModalHost";

const repoSetupModalStore = vi.hoisted(() => {
  const state = {
    modal: null as {
      repoRootId: string;
      sourceRoot: string;
      repoName: string;
    } | null,
    open: (modal: { repoRootId: string; sourceRoot: string; repoName: string }) => {
      state.modal = modal;
    },
    close: () => {
      state.modal = null;
    },
  };

  const store = Object.assign(
    <Selected,>(selector: (value: typeof state) => Selected) => selector(state),
    {
      getState: () => state,
    },
  );

  return { state, store };
});

vi.mock("@/stores/ui/repo-setup-modal-store", () => ({
  useRepoSetupModalStore: repoSetupModalStore.store,
}));

vi.mock("./RepoSetupModal", () => ({
  RepoSetupModal: ({
    repoRootId,
    sourceRoot,
    repoName,
  }: {
    repoRootId: string;
    sourceRoot: string;
    repoName: string;
    onClose: () => void;
  }) => createElement(
    "div",
    { "data-testid": "repo-setup-modal" },
    `${repoRootId}:${sourceRoot}:${repoName}`,
  ),
}));

describe("RepoSetupModalHost", () => {
  beforeEach(() => {
    repoSetupModalStore.state.close();
  });

  it("renders the repo setup modal when the store is opened outside the sidebar tree", () => {
    repoSetupModalStore.state.open({
      repoRootId: "repo-1",
      sourceRoot: "/tmp/proliferate",
      repoName: "proliferate",
    });

    const html = renderToStaticMarkup(createElement(RepoSetupModalHost));

    expect(html).toContain("data-testid=\"repo-setup-modal\"");
    expect(html).toContain("repo-1:/tmp/proliferate:proliferate");
  });

  it("renders nothing when the modal store is closed", () => {
    const html = renderToStaticMarkup(createElement(RepoSetupModalHost));

    expect(html).toBe("");
  });
});
