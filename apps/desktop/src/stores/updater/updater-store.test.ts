import { beforeEach, describe, expect, it } from "vitest";
import { useUpdaterStore } from "./updater-store";

describe("updater store", () => {
  beforeEach(() => {
    useUpdaterStore.getState().reset();
  });

  it("records which step produced the error", () => {
    useUpdaterStore.getState().setError("release feed unreachable", "check");

    expect(useUpdaterStore.getState().phase).toBe("error");
    expect(useUpdaterStore.getState().errorMessage).toBe("release feed unreachable");
    expect(useUpdaterStore.getState().errorSource).toBe("check");

    useUpdaterStore.getState().setError("disk full", "download");

    expect(useUpdaterStore.getState().errorSource).toBe("download");
  });

  it("clears the error source when leaving the error phase", () => {
    useUpdaterStore.getState().setError("release feed unreachable", "check");
    useUpdaterStore.getState().setPhase("checking");

    expect(useUpdaterStore.getState().errorMessage).toBeNull();
    expect(useUpdaterStore.getState().errorSource).toBeNull();

    useUpdaterStore.getState().setError("disk full", "download");
    useUpdaterStore.getState().setAvailable("0.2.0", {});

    expect(useUpdaterStore.getState().errorMessage).toBeNull();
    expect(useUpdaterStore.getState().errorSource).toBeNull();
  });

  it("tracks the one-shot manual check completion signal", () => {
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();

    useUpdaterStore.getState().setManualCheckCompleted(1_234);
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBe(1_234);

    useUpdaterStore.getState().clearManualCheckCompleted();
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
  });

  it("arms and disarms restart-when-idle", () => {
    useUpdaterStore.getState().setRestartWhenIdle(true);
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(true);

    // A newly available update belongs to a fresh flow — the old arm no longer applies.
    useUpdaterStore.getState().setAvailable("0.2.0", {});
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(false);
  });

  it("reset clears error source, manual check signal, and armed restart", () => {
    useUpdaterStore.getState().setError("disk full", "download");
    useUpdaterStore.getState().setManualCheckCompleted(1_234);
    useUpdaterStore.getState().setRestartWhenIdle(true);

    useUpdaterStore.getState().reset();

    expect(useUpdaterStore.getState().errorSource).toBeNull();
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(false);
  });
});
