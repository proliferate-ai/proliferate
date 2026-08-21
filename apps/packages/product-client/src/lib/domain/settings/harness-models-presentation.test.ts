import { describe, expect, it } from "vitest";
import {
  resolveAllModelsPresentation,
  type AllModelsPresentationInput,
  type HarnessModelsFetchStatus,
  type HarnessModelsQueryFacts,
} from "./harness-models-presentation";

function facts(overrides: Partial<HarnessModelsQueryFacts> = {}): HarnessModelsQueryFacts {
  return {
    isError: false,
    errorCode: null,
    serverAnswered: false,
    isPending: true,
    fetchStatus: "idle",
    ...overrides,
  };
}

/** A settled query that answered: not pending, nothing in flight. */
const SETTLED = facts({ isPending: false });

function input(overrides: Partial<AllModelsPresentationInput> = {}): AllModelsPresentationInput {
  return {
    surface: "local",
    displayName: "Claude",
    connectionState: "healthy",
    hasLocalRuntimeHost: true,
    runtimeQuery: facts(),
    sandboxQuery: SETTLED,
    hasCloudSandboxId: false,
    cloudLaunchOptionsQuery: facts(),
    launchOptions: undefined,
    isRefreshMutationPending: false,
    isRefreshMutationPaused: false,
    modelCount: 0,
    freshnessAgo: null,
    ...overrides,
  };
}

describe("resolveAllModelsPresentation — every no-payload cause is its own arm", () => {
  it("E-R22: connecting and failed are different facts, not one disabled query", () => {
    const connecting = resolveAllModelsPresentation(
      input({ connectionState: "connecting" }),
    );
    const failed = resolveAllModelsPresentation(input({ connectionState: "failed" }));

    expect(connecting.kind).toBe("runtime_connecting");
    expect(failed.kind).toBe("runtime_failed");
    expect(connecting.title).not.toBe(failed.title);
    expect(connecting.detail).not.toBe(failed.detail);
  });

  it("E-R22/E-R33: a failed runtime carries the cure that actually works", () => {
    const failed = resolveAllModelsPresentation(input({ connectionState: "failed" }));

    // `pollUntilHealthy` already gave up; the read will not retry itself.
    expect(failed.detail).not.toMatch(/as soon as|when the connection is back/i);
    expect(failed.detail).toMatch(/restart/i);
    // E-R33: restarting the runtime is a control this pane can render and one
    // that genuinely moves the runtime, unlike relaunching the application.
    expect(failed.retry).toBe("restart_runtime");
    // `refresh_now` still cannot reach a runtime that is not up.
    expect(failed.refresh).toBe("disabled");
  });

  it("E-R22: connecting says it resolves itself and offers no dead control", () => {
    const connecting = resolveAllModelsPresentation(
      input({ connectionState: "connecting" }),
    );
    expect(connecting.retry).toBeNull();
    expect(connecting.refresh).toBe("disabled");
    expect(connecting.detail).toMatch(/as soon as it's ready/i);
  });

  it("E-R23: an offline-paused read is neither a spinner nor a failure", () => {
    const paused = resolveAllModelsPresentation(
      input({ runtimeQuery: facts({ fetchStatus: "paused" }) }),
    );
    expect(paused.kind).toBe("offline_paused");
    expect(paused.title).toBe("You're offline");
    expect(paused.detail).not.toMatch(/Loading/i);
    // The refresh mutation is parked by the same gate, so it must not look live.
    expect(paused.refresh).toBe("disabled");
  });

  it("E-R23: a genuinely in-flight read is still the only thing that spins", () => {
    const loading = resolveAllModelsPresentation(
      input({ runtimeQuery: facts({ fetchStatus: "fetching" }) }),
    );
    expect(loading.kind).toBe("loading");
    expect(loading.detail).toBe("Loading models…");
  });

  it("E-R24: a structured not-observed 404 is not a transport error", () => {
    const notObserved = resolveAllModelsPresentation(input({
      surface: "cloud",
      hasCloudSandboxId: true,
      cloudLaunchOptionsQuery: facts({
        isError: true,
        isPending: false,
        errorCode: "harness_launch_options_not_observed",
      }),
    }));

    expect(notObserved.kind).toBe("not_observed_yet");
    expect(notObserved.title).toBe("Models haven't been detected yet");
    expect(notObserved.detail).toBe("Claude reports models after its first run in this workspace.");
    // The server answered. Re-issuing the same GET 404s forever.
    expect(notObserved.retry).toBeNull();
  });

  it("E-R24: an unstructured cloud failure keeps the error arm and its Retry", () => {
    const transport = resolveAllModelsPresentation(input({
      surface: "cloud",
      hasCloudSandboxId: true,
      cloudLaunchOptionsQuery: facts({ isError: true, isPending: false, errorCode: null }),
    }));

    expect(transport.kind).toBe("cloud_read_error");
    expect(transport.title).toBe("Models couldn't be loaded");
    // Names the hop that actually failed, not the local runtime.
    expect(transport.detail).toBe("Proliferate Cloud didn't respond.");
    expect(transport.retry).toBe("refetch_read");
  });

  it("E-R25: no-workspace is asserted from the sandbox answer, not a disabled query", () => {
    // Same disabled dependent query in both cases; only the FACT differs.
    const noWorkspace = resolveAllModelsPresentation(input({
      surface: "cloud",
      hasCloudSandboxId: false,
      cloudLaunchOptionsQuery: facts(),
    }));
    const withWorkspace = resolveAllModelsPresentation(input({
      surface: "cloud",
      hasCloudSandboxId: true,
      cloudLaunchOptionsQuery: facts(),
    }));

    expect(noWorkspace.kind).toBe("cloud_no_workspace");
    expect(withWorkspace.kind).not.toBe("cloud_no_workspace");
  });

  it("a sandbox read that is still in flight or failing is not 'no workspace'", () => {
    expect(resolveAllModelsPresentation(input({
      surface: "cloud",
      sandboxQuery: facts({ fetchStatus: "fetching" }),
    })).kind).toBe("loading");

    const errored = resolveAllModelsPresentation(input({
      surface: "cloud",
      sandboxQuery: facts({ isError: true, isPending: false }),
    }));
    expect(errored.kind).toBe("cloud_read_error");
    expect(errored.retry).toBe("refetch_read");
  });

  it("every no-payload arm ends in a cure or a self-resolution — never a dead end", () => {
    const arms: AllModelsPresentation[] = [
      resolveAllModelsPresentation(input({ connectionState: "connecting" })),
      resolveAllModelsPresentation(input({ connectionState: "failed" })),
      resolveAllModelsPresentation(input({ runtimeQuery: facts({ fetchStatus: "paused" }) })),
      resolveAllModelsPresentation(input({ runtimeQuery: facts({ fetchStatus: "fetching" }) })),
      resolveAllModelsPresentation(input({ runtimeQuery: facts({ fetchStatus: "idle" }) })),
      resolveAllModelsPresentation(input({ runtimeQuery: facts({ isError: true, isPending: false }) })),
      resolveAllModelsPresentation(input({ hasLocalRuntimeHost: false })),
      resolveAllModelsPresentation(input({ surface: "cloud" })),
      resolveAllModelsPresentation(input({
        surface: "cloud",
        hasCloudSandboxId: true,
        cloudLaunchOptionsQuery: facts({
          isError: true, isPending: false, errorCode: "harness_launch_options_not_observed",
        }),
      })),
    ];

    for (const arm of arms) {
      const hasCure = arm.retry !== null || arm.refresh === "enabled";
      const saysItResolvesItself = /as soon as|when the connection is back|after its first/i
        .test(arm.detail ?? "");
      // Or it names the condition that clears it, which is itself something
      // the user can go and do (create a workspace, run the agent once, open
      // the desktop app).
      const namesAnAction = /restart|retry|once .+ exists|desktop app/i.test(arm.detail ?? "");
      expect(
        { kind: arm.kind, ok: hasCure || saysItResolvesItself || namesAnAction },
      ).toEqual({ kind: arm.kind, ok: true });
      // And never a body line that contradicts the header it sits under.
      expect(arm.emptyBody).toBeNull();
    }
  });

  it("E-R30: only the codes the route emits get an arm; the rest get no false cause", () => {
    function cloudFailure(overrides: Partial<HarnessModelsQueryFacts>) {
      return resolveAllModelsPresentation(input({
        surface: "cloud",
        hasCloudSandboxId: true,
        cloudLaunchOptionsQuery: facts({ isError: true, isPending: false, ...overrides }),
      }));
    }

    // The other structured 404 the same GET emits: a culled or unowned
    // sandbox. Durable, and re-reading the sandbox is a cure the never-had-one
    // arm does not have.
    const staleSandbox = cloudFailure({
      errorCode: "cloud_sandbox_not_found",
      serverAnswered: true,
    });
    expect(staleSandbox.kind).toBe("cloud_no_workspace");
    expect(staleSandbox.detail).not.toBe("Proliferate Cloud didn't respond.");
    expect(staleSandbox.retry).toBe("refetch_read");

    // An answered error is not silence.
    const answered = cloudFailure({ errorCode: null, serverAnswered: true });
    expect(answered.kind).toBe("cloud_read_error");
    expect(answered.detail).toBe("Proliferate Cloud returned an error.");

    // And silence is the one case where claiming it is established fact.
    const silent = cloudFailure({ errorCode: null, serverAnswered: false });
    expect(silent.detail).toBe("Proliferate Cloud didn't respond.");
  });

  it("E-R34: a host with no local runtime is terminal, not connecting", () => {
    // Web: nothing ever writes `connectionState`, so it reports its initial
    // "connecting" for as long as the pane is open.
    const web = resolveAllModelsPresentation(input({
      hasLocalRuntimeHost: false,
      connectionState: "connecting",
    }));

    expect(web.kind).toBe("local_runtime_unavailable");
    expect(web.detail).not.toMatch(/as soon as it's ready/i);
    // Terminal: nothing spins and no control pretends it can help.
    expect(web.refresh).toBe("disabled");
    expect(web.retry).toBeNull();
  });

  it("E-R35: a settled launch-options answer outranks a sandbox refetch in flight", () => {
    const refetching = resolveAllModelsPresentation(input({
      surface: "cloud",
      hasCloudSandboxId: true,
      sandboxQuery: facts({ isPending: false, fetchStatus: "fetching" }),
      cloudLaunchOptionsQuery: facts({
        isError: true, isPending: false, serverAnswered: true,
        errorCode: "harness_launch_options_not_observed",
      }),
    }));

    expect(refetching.kind).toBe("not_observed_yet");
    expect(refetching.detail).not.toBe("Loading models…");
  });

  it("the unreachable enabled-but-never-started read is enumerated with a working cure", () => {
    const awaiting = resolveAllModelsPresentation(
      input({ runtimeQuery: facts({ fetchStatus: "idle", isPending: true }) }),
    );
    expect(awaiting.kind).toBe("awaiting_first_read");
    expect(awaiting.retry).toBe("refetch_read");
  });
});

describe("resolveAllModelsPresentation — a payload always outranks the no-payload arms", () => {
  const payload = {
    harnessKind: "claude",
    basisRevision: "b1",
    revision: 1,
    state: "observed",
    options: {
      models: [{ id: "m-1", observedName: "Model 1", observedDescription: null }],
      controls: [],
      defaults: { modelId: null, controlValues: {} },
    },
    observedAt: "2026-08-21T11:58:00Z",
    probeAttemptedAt: "2026-08-21T11:58:00Z",
    probeFailureCode: null,
    readiness: "ready",
    probePhase: "idle",
  } as unknown as AllModelsPresentationInput["launchOptions"];

  const CONNECTION_STATES = ["connecting", "healthy", "failed"] as const;
  const FETCH_STATUSES: HarnessModelsFetchStatus[] = ["fetching", "paused", "idle"];

  it("renders the observation regardless of connection state or fetch status", () => {
    for (const connectionState of CONNECTION_STATES) {
      for (const fetchStatus of FETCH_STATUSES) {
        const result = resolveAllModelsPresentation(input({
          connectionState,
          runtimeQuery: facts({ fetchStatus, isPending: false }),
          launchOptions: payload,
          modelCount: 1,
          freshnessAgo: "2m ago",
        }));
        expect({ connectionState, fetchStatus, kind: result.kind, title: result.title })
          .toEqual({ connectionState, fetchStatus, kind: "settled_count", title: "1 model" });
      }
    }
  });
});

describe("resolveAllModelsPresentation — the refresh control is not a proxy either", () => {
  const observed = {
    harnessKind: "claude",
    basisRevision: "b1",
    revision: 1,
    state: "observed",
    options: { models: [], controls: [], defaults: { modelId: null, controlValues: {} } },
    observedAt: "2026-08-21T11:58:00Z",
    probeAttemptedAt: "2026-08-21T11:58:00Z",
    probeFailureCode: null,
    readiness: "ready",
    probePhase: "idle",
  } as unknown as AllModelsPresentationInput["launchOptions"];

  it("E-R28: a parked mutation is not a running one", () => {
    const settled = input({
      runtimeQuery: facts({ isPending: false }),
      launchOptions: observed,
      freshnessAgo: "2m ago",
    });

    const running = resolveAllModelsPresentation({ ...settled, isRefreshMutationPending: true });
    expect(running.refresh).toBe("spinning");

    // Same `isPending`, and query-core will wait for `online` with no timeout.
    const parked = resolveAllModelsPresentation({
      ...settled,
      isRefreshMutationPending: true,
      isRefreshMutationPaused: true,
    });
    expect(parked.refresh).toBe("disabled");
    expect(parked.kind).toBe("refresh_offline_paused");
    expect(parked.title).toBe("You're offline");
    expect(parked.detail).toBe("The refresh runs when the connection is back.");
    // Every retry this pane offers is a request the same gate would park.
    expect(parked.retry).toBeNull();
  });

  it("E-R28: a parked mutation does not overwrite a more specific local fact", () => {
    const failed = resolveAllModelsPresentation(input({
      connectionState: "failed",
      isRefreshMutationPending: true,
      isRefreshMutationPaused: true,
    }));

    // "You're offline" would be the wrong reason: the runtime did not start.
    expect(failed.kind).toBe("runtime_failed");
    expect(failed.refresh).toBe("disabled");
  });

  it("E-R29: a pending mutation never repaints a deliberately disabled control", () => {
    for (const connectionState of ["connecting", "failed"] as const) {
      const result = resolveAllModelsPresentation(input({
        connectionState,
        isRefreshMutationPending: true,
      }));
      expect({ connectionState, refresh: result.refresh })
        .toEqual({ connectionState, refresh: "disabled" });
    }
    // And the host that has no runtime at all.
    expect(resolveAllModelsPresentation(input({
      hasLocalRuntimeHost: false,
      isRefreshMutationPending: true,
    })).refresh).toBe("disabled");
  });

  it("E-R31: every arm owns its own empty line, error or not", () => {
    const empty = input({
      runtimeQuery: facts({ isPending: false }),
      launchOptions: observed,
      modelCount: 0,
      freshnessAgo: "2m ago",
    });

    // A failed background refetch does not change "0 models", so it must not
    // blank a body line that agrees with that header.
    expect(resolveAllModelsPresentation(empty).emptyBody).toBe("No models detected yet.");
    expect(resolveAllModelsPresentation({
      ...empty,
      runtimeQuery: facts({ isPending: false, isError: true }),
    }).emptyBody).toBe("No models detected yet.");
  });

  it("E-R32: a stale in-flight read never outranks the connection fact", () => {
    // The hazard the ordering removed: `ProductProviderRoot` blanks the runtime
    // URL for every non-healthy state in the same commit, so this pairing is
    // unreachable today — but the resolver no longer depends on that.
    for (const connectionState of ["connecting", "failed"] as const) {
      const result = resolveAllModelsPresentation(input({
        connectionState,
        runtimeQuery: facts({ fetchStatus: "fetching" }),
      }));
      expect({ connectionState, kind: result.kind, refresh: result.refresh }).toEqual({
        connectionState,
        kind: connectionState === "connecting" ? "runtime_connecting" : "runtime_failed",
        refresh: "disabled",
      });
    }
  });
});

type AllModelsPresentation = ReturnType<typeof resolveAllModelsPresentation>;
