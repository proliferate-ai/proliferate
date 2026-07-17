import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitSupersededSessionCreation,
  publishSessionCreationIfCurrent,
  registerSessionCreation,
  resetSessionCreationSupersessionForTests,
  rollbackSupersededSessionCreation,
  shouldDiscardSupersededSessionCreation,
  subscribeToSessionCreationSupersession,
  supersedeInFlightSessionCreation,
} from "#product/hooks/sessions/workflows/session-creation-supersession";

beforeEach(() => {
  resetSessionCreationSupersessionForTests();
});

describe("session creation supersession", () => {
  it("pauses an in-flight materializer until replacement commits", async () => {
    const unregister = registerSessionCreation("old-session");
    expect(supersedeInFlightSessionCreation("old-session")).toBe(true);

    let settled = false;
    const disposition = shouldDiscardSupersededSessionCreation("old-session")
      .then((discard) => {
        settled = true;
        return discard;
      });
    await Promise.resolve();
    expect(settled).toBe(false);

    commitSupersededSessionCreation("old-session");
    await expect(disposition).resolves.toBe(true);
    unregister();
  });

  it("lets the original materializer continue after replacement rollback", async () => {
    const unregister = registerSessionCreation("old-session");
    supersedeInFlightSessionCreation("old-session");
    const disposition = shouldDiscardSupersededSessionCreation("old-session");

    rollbackSupersededSessionCreation("old-session");

    await expect(disposition).resolves.toBe(false);
    unregister();
  });

  it("blocks publication when replacement starts after a stale async checkpoint", async () => {
    const unregister = registerSessionCreation("old-session");
    const staleCheckpoint = shouldDiscardSupersededSessionCreation("old-session");
    supersedeInFlightSessionCreation("old-session");
    await expect(staleCheckpoint).resolves.toBe(false);
    const publish = vi.fn();

    const publication = publishSessionCreationIfCurrent({
      sessionId: "old-session",
      onSuperseded: () => shouldDiscardSupersededSessionCreation("old-session"),
      publish,
    });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();

    commitSupersededSessionCreation("old-session");
    await expect(publication).resolves.toBe(false);
    expect(publish).not.toHaveBeenCalled();
    unregister();
  });

  it("publishes after a tail-racing replacement rolls back", async () => {
    const unregister = registerSessionCreation("old-session");
    const staleCheckpoint = shouldDiscardSupersededSessionCreation("old-session");
    supersedeInFlightSessionCreation("old-session");
    await expect(staleCheckpoint).resolves.toBe(false);
    const publish = vi.fn();

    const publication = publishSessionCreationIfCurrent({
      sessionId: "old-session",
      onSuperseded: () => shouldDiscardSupersededSessionCreation("old-session"),
      publish,
    });
    rollbackSupersededSessionCreation("old-session");

    await expect(publication).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("rechecks ownership when rollback is immediately followed by another replacement", async () => {
    const unregister = registerSessionCreation("old-session");
    supersedeInFlightSessionCreation("old-session");
    const publish = vi.fn();
    let replacementCount = 1;
    const publication = publishSessionCreationIfCurrent({
      sessionId: "old-session",
      onSuperseded: async () => {
        const shouldDiscard = await shouldDiscardSupersededSessionCreation(
          "old-session",
        );
        if (!shouldDiscard && replacementCount === 1) {
          replacementCount += 1;
          supersedeInFlightSessionCreation("old-session");
        }
        return shouldDiscard;
      },
      publish,
    });

    rollbackSupersededSessionCreation("old-session");
    await vi.waitFor(() => expect(replacementCount).toBe(2));
    expect(publish).not.toHaveBeenCalled();
    commitSupersededSessionCreation("old-session");

    await expect(publication).resolves.toBe(false);
    expect(publish).not.toHaveBeenCalled();
    unregister();
  });

  it("signals a later replacement after an earlier replacement rolls back", async () => {
    const unregister = registerSessionCreation("old-session");
    supersedeInFlightSessionCreation("old-session");
    rollbackSupersededSessionCreation("old-session");
    const signalled = new Promise<void>((resolve) => {
      subscribeToSessionCreationSupersession("old-session", resolve);
    });

    supersedeInFlightSessionCreation("old-session");
    await expect(signalled).resolves.toBeUndefined();
    commitSupersededSessionCreation("old-session");
    await expect(shouldDiscardSupersededSessionCreation("old-session"))
      .resolves.toBe(true);
    unregister();
  });

  it("does not create a tombstone when no materialization is in flight", async () => {
    expect(supersedeInFlightSessionCreation("materialized-session")).toBe(false);
    commitSupersededSessionCreation("materialized-session");
    await expect(shouldDiscardSupersededSessionCreation("materialized-session"))
      .resolves.toBe(false);
  });

  it("composes A to B to C replacements without resurrecting either superseded create", async () => {
    const unregisterA = registerSessionCreation("session-a");
    supersedeInFlightSessionCreation("session-a");
    const dispositionA = shouldDiscardSupersededSessionCreation("session-a");

    const unregisterB = registerSessionCreation("session-b");
    supersedeInFlightSessionCreation("session-b");
    const dispositionB = shouldDiscardSupersededSessionCreation("session-b");

    // C succeeds, so B is discarded. B's replacement promise can then settle
    // successfully and commit A's transaction as well.
    commitSupersededSessionCreation("session-b");
    await expect(dispositionB).resolves.toBe(true);
    commitSupersededSessionCreation("session-a");
    await expect(dispositionA).resolves.toBe(true);

    unregisterB();
    unregisterA();
  });

  it("lets B continue when C fails during an A to B to C replacement chain", async () => {
    const unregisterA = registerSessionCreation("session-a");
    supersedeInFlightSessionCreation("session-a");
    const dispositionA = shouldDiscardSupersededSessionCreation("session-a");

    const unregisterB = registerSessionCreation("session-b");
    supersedeInFlightSessionCreation("session-b");
    const dispositionB = shouldDiscardSupersededSessionCreation("session-b");

    rollbackSupersededSessionCreation("session-b");
    await expect(dispositionB).resolves.toBe(false);
    commitSupersededSessionCreation("session-a");
    await expect(dispositionA).resolves.toBe(true);

    unregisterB();
    unregisterA();
  });
});
