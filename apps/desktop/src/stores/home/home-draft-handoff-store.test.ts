import { beforeEach, describe, expect, it } from "vitest";
import { useHomeDraftHandoffStore } from "./home-draft-handoff-store";

describe("home draft handoff store", () => {
  beforeEach(() => {
    useHomeDraftHandoffStore.setState({ draftText: null });
  });

  it("stores and clears a draft for Home restoration", () => {
    useHomeDraftHandoffStore.getState().setDraftText("restore me");

    expect(useHomeDraftHandoffStore.getState().draftText).toBe("restore me");

    useHomeDraftHandoffStore.getState().clearDraftText();

    expect(useHomeDraftHandoffStore.getState().draftText).toBeNull();
  });
});
