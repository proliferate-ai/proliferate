import { describe, expect, it } from "vitest";
import {
  confirmRepoRemoval,
  repoRemovalConfirmationCopy,
  requestRepoRemovalConfirmation,
} from "./repo-context-menu";

describe("repoRemovalConfirmationCopy", () => {
  it("models removal as destructive confirmation outside the menu", () => {
    expect(repoRemovalConfirmationCopy("proliferate")).toEqual({
      title: "Remove repository?",
      description: "Remove proliferate from the sidebar. Local files and workspaces are not deleted.",
      confirmLabel: "Remove repository",
      confirmVariant: "destructive",
    });
  });

  it("opens confirmation from the menu command", () => {
    let open = false;
    requestRepoRemovalConfirmation(() => {
      open = true;
    });

    expect(open).toBe(true);
  });

  it("resets confirmation state before removing the repo", () => {
    const calls: string[] = [];
    confirmRepoRemoval({
      closeConfirmation: () => calls.push("close"),
      removeRepo: () => calls.push("remove"),
    });

    expect(calls).toEqual(["close", "remove"]);
  });
});
