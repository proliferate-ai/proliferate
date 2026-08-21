import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: mocks,
}));

async function loadDesktopPostHog() {
  vi.resetModules();
  return import("./posthog");
}

const ENABLED_CONFIG = {
  environment: "production",
  release: "proliferate-desktop@1.2.3+abcdef123456",
  posthog: {
    enabled: true,
    apiKey: "phc_test",
    apiHost: "https://us.i.posthog.com",
  },
};

describe("desktop PostHog adapter", () => {
  beforeEach(() => {
    mocks.init.mockReset();
    mocks.register.mockReset();
    mocks.capture.mockReset();
    mocks.identify.mockReset();
    mocks.reset.mockReset();
    mocks.startSessionRecording.mockReset();
    mocks.stopSessionRecording.mockReset();
  });

  it("initializes once with recording disabled and no auto-start surface", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    expect(mocks.init).toHaveBeenCalledOnce();

    const [apiKey, options] = mocks.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(apiKey).toBe("phc_test");
    const {
      before_send: beforeSend,
      session_recording: sessionRecording,
      ...rest
    } = options;
    expect(rest).toEqual({
      api_host: "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      person_profiles: "identified_only",
      disable_session_recording: true,
      // Local literal, so the PostHog project cannot start console capture.
      enable_recording_console_log: false,
    });
    const scrub = await import("./scrub");
    expect(beforeSend).toBe(scrub.scrubPostHogPayload);
    expect(sessionRecording).toBe(adapter.DESKTOP_SESSION_RECORDING_OPTIONS);
    expect(Object.keys(options).sort()).toEqual([
      "api_host",
      "autocapture",
      "before_send",
      "capture_pageleave",
      "capture_pageview",
      "disable_session_recording",
      "enable_recording_console_log",
      "person_profiles",
      "session_recording",
    ]);
    // No `loaded` callback and no start call: recording cannot begin at init.
    expect(options.loaded).toBeUndefined();
    expect(mocks.startSessionRecording).not.toHaveBeenCalled();
  });

  it("pins the recorder to mask content and redact route identifiers", async () => {
    const adapter = await loadDesktopPostHog();
    const options = adapter.DESKTOP_SESSION_RECORDING_OPTIONS;

    expect(options.maskAllInputs).toBe(true);
    expect(options.maskTextSelector).toBe("*");
    expect(options.blockSelector).toBe("[data-telemetry-block]");
    expect(options.collectFonts).toBe(false);
    expect(options.recordCrossOriginIframes).toBe(false);
    expect(options.recordHeaders).toBe(false);
    expect(options.recordBody).toBe(false);
    expect(options.maskCapturedNetworkRequestFn()).toBeNull();

    // Canvas frames are pixels; `maskTextSelector: "*"` does not reach them,
    // and `@xterm/addon-canvas` renders terminal output to a canvas. This must
    // stay a local literal `false` or the PostHog project's
    // `canvasRecording.enabled` decides on its own.
    expect(options.captureCanvas).toEqual({ recordCanvas: false });

    // Dormant forward-compatibility, NOT coverage: the pinned
    // posthog-js@1.386.8 forwards only maskAllInputs/maskTextSelector/
    // blockSelector to rrweb and never invokes this callback. It is asserted
    // so the wiring stays correct for a future SDK pin. The live proof that
    // route ids never reach a payload is the before_send boundary, in
    // product-client's route-id-redaction.test.ts.
    expect(options.maskAttributeFn("href", "/workflows/wf-secret-id")).toBe(
      "/workflows/:workflowId",
    );
    expect(
      options.maskAttributeFn("src", "https://app.proliferate.com/workspaces/ws-secret"),
    ).toBe("https://app.proliferate.com/workspaces/:workspaceId");
  });

  it("starts replay only when explicitly asked, and only once", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    adapter.startDesktopPostHogSessionReplay();
    adapter.startDesktopPostHogSessionReplay();

    expect(mocks.startSessionRecording).toHaveBeenCalledOnce();

    adapter.stopDesktopPostHogSessionReplay();
    adapter.stopDesktopPostHogSessionReplay();

    expect(mocks.stopSessionRecording).toHaveBeenCalledOnce();
  });

  it("refuses to start or stop replay before initialization", async () => {
    const adapter = await loadDesktopPostHog();

    adapter.startDesktopPostHogSessionReplay();
    adapter.stopDesktopPostHogSessionReplay();

    expect(mocks.startSessionRecording).not.toHaveBeenCalled();
    expect(mocks.stopSessionRecording).not.toHaveBeenCalled();
  });

  it("refuses to stop a replay that never started", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    adapter.stopDesktopPostHogSessionReplay();

    expect(mocks.stopSessionRecording).not.toHaveBeenCalled();
  });

  it("strips route identifiers from the replay payload posthog would send", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    const [, options] = mocks.init.mock.calls[0] as [string, Record<string, unknown>];
    const beforeSend = options.before_send as (
      event: Record<string, unknown> | null,
    ) => Record<string, unknown> | null;

    const workflowId = "wf-8e1c4a92-route-id-leak-probe";
    const workspaceId = "ws-c30a6e75-route-id-leak-probe";

    // Nested past the shared scrubber's depth cap so this also proves the
    // replay stream is not shredded on its way through `before_send`.
    let node: Record<string, unknown> = {
      type: 2,
      tagName: "a",
      attributes: { href: `/workspaces/${workspaceId}`, class: "deep-link" },
      childNodes: [],
    };
    for (let depth = 0; depth < 14; depth += 1) {
      node = {
        type: 2,
        tagName: "div",
        attributes: { class: `layer-${depth}` },
        childNodes: [node],
      };
    }

    const sent = beforeSend({
      event: "$snapshot",
      properties: {
        $current_url: `https://app.proliferate.com/workflows/${workflowId}`,
        $pathname: `/workflows/${workflowId}`,
        $snapshot_data: [
          {
            type: 4,
            data: { href: `https://app.proliferate.com/workflows/${workflowId}` },
          },
          { type: 2, data: { node } },
        ],
      },
    });

    const serialized = JSON.stringify(sent);
    expect(serialized).not.toContain(workflowId);
    expect(serialized).not.toContain(workspaceId);
    expect(serialized).toContain("/workflows/:workflowId");
    expect(serialized).toContain("/workspaces/:workspaceId");
    // The replay stream survives the scrubber intact enough to play back.
    expect(serialized).not.toContain("[truncated]");
    expect(serialized).toContain("layer-13");
    expect(serialized).toContain("deep-link");
  });

  it("still scrubs non-replay captures through the shared scrubber", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    const [, options] = mocks.init.mock.calls[0] as [string, Record<string, unknown>];
    const beforeSend = options.before_send as (
      event: Record<string, unknown> | null,
    ) => Record<string, unknown> | null;

    const sent = beforeSend({
      event: "chat_prompt_submitted",
      properties: {
        agent_kind: "claude",
        prompt: "write my private code",
        $current_url: "https://app.proliferate.com/workspaces/ws-secret",
      },
    });

    const properties = sent?.properties as Record<string, unknown>;
    expect(properties.prompt).toBe("[redacted]");
    expect(properties.agent_kind).toBe("claude");
    expect(properties.$current_url).toBe(
      "https://app.proliferate.com/workspaces/:workspaceId",
    );
  });

  it("captures typed product events through the scrubber", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    adapter.trackDesktopPostHogEvent("app_update_available", { version: "1.2.3" });

    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture.mock.calls[0]?.[0]).toBe("app_update_available");
  });

  it("identifies with the authenticated user id only", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    adapter.identifyDesktopPostHogUser("user-123");

    expect(mocks.identify).toHaveBeenCalledOnce();
    expect(mocks.identify).toHaveBeenCalledWith("user-123");
    expect(JSON.stringify(mocks.identify.mock.calls)).not.toContain("user@example.com");
    expect(JSON.stringify(mocks.identify.mock.calls)).not.toContain("Private Person");
  });

  it("keeps registered context and reset behavior unchanged", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    expect(mocks.register).toHaveBeenCalledWith({
      app: "proliferate-desktop",
      surface: "desktop",
      environment: "production",
      release: "proliferate-desktop@1.2.3+abcdef123456",
    });

    adapter.resetDesktopPostHogUser();
    expect(mocks.reset).toHaveBeenCalledWith(true);
  });

  it("keeps identity and reset as no-ops before initialization", async () => {
    const adapter = await loadDesktopPostHog();

    adapter.identifyDesktopPostHogUser("user-123");
    adapter.resetDesktopPostHogUser();

    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("does not initialize without an enabled API key", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog({
      ...ENABLED_CONFIG,
      posthog: { ...ENABLED_CONFIG.posthog, apiKey: "" },
    });

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
