// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepoSetupModal } from "./RepoSetupModal";

const SOURCE_ROOT = "/tmp/proliferate";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderModal(onClose = vi.fn()) {
  render(
    <RepoSetupModal
      sourceRoot={SOURCE_ROOT}
      repoName="proliferate"
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe("RepoSetupModal", () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a compact confirmation for the added repository", () => {
    renderModal();

    expect(screen.getByText("Repository added")).toBeTruthy();
    expect(screen.getByText("proliferate")).toBeTruthy();
    expect(screen.getByText(SOURCE_ROOT)).toBeTruthy();
    expect(screen.queryByText("Setup script")).toBeNull();
  });

  it("closes without navigation when done", () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("closes and opens repo settings when customizing defaults", () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Customize defaults" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/settings?section=repo&repo=%2Ftmp%2Fproliferate");
  });
});
