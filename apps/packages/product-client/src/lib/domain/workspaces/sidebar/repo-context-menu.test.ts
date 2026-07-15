import { describe, expect, it, vi } from "vitest";
import {
  confirmRepoRemoval,
  repoRemovalConfirmationCopy,
  requestRepoRemovalConfirmation,
} from "#product/lib/domain/workspaces/sidebar/repo-context-menu";

describe("repoRemovalConfirmationCopy", () => {
  it("models removal as destructive confirmation outside the menu", () => {
    expect(repoRemovalConfirmationCopy("proliferate", true)).toEqual({
      title: "Remove repository?",
      description: "Remove proliferate from Cloud and this sidebar. Local files and workspaces are not deleted.",
      confirmLabel: "Remove repository",
      confirmVariant: "destructive",
    });
  });

  it("does not claim a Cloud mutation for local-only repositories", () => {
    expect(repoRemovalConfirmationCopy("proliferate").description).toBe(
      "Remove proliferate from the sidebar. Local files and workspaces are not deleted.",
    );
  });

  it("opens confirmation from the menu command", () => {
    let open = false;
    requestRepoRemovalConfirmation(() => {
      open = true;
    });

    expect(open).toBe(true);
  });

  it("closes confirmation only after removing the repo", async () => {
    const calls: string[] = [];
    await confirmRepoRemoval({
      closeConfirmation: () => calls.push("close"),
      removeRepo: () => {
        calls.push("remove");
      },
    });

    expect(calls).toEqual(["remove", "close"]);
  });

  it("keeps confirmation open when removal fails", async () => {
    const close = vi.fn();
    await expect(confirmRepoRemoval({
      closeConfirmation: close,
      removeRepo: () => Promise.reject(new Error("server rejected removal")),
    })).rejects.toThrow("server rejected removal");
    expect(close).not.toHaveBeenCalled();
  });
});
