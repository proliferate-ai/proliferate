import { describe, expect, it, vi } from "vitest";

import {
  AnyHarnessError,
  AnyHarnessTransport,
  hasAnyHarnessRuntimeIncidentReceipt,
  toAnyHarnessTelemetryError,
} from "./core.js";

describe("AnyHarnessTransport problem details", () => {
  it("preserves valid RFC 7807 fields", async () => {
    const error = await requestError(problemResponse({
      type: "https://runtime.test/problems/model-gated",
      title: "Model access required",
      status: 403,
      detail: "Connect a supported provider",
      code: "SESSION_MODEL_GATED",
      instance: "/v1/sessions/session-1",
      requiredContexts: ["anthropic"],
    }, 502));

    expect(error.message).toBe("Connect a supported provider");
    expect(error.problem).toEqual({
      type: "https://runtime.test/problems/model-gated",
      title: "Model access required",
      status: 403,
      detail: "Connect a supported provider",
      code: "SESSION_MODEL_GATED",
      instance: "/v1/sessions/session-1",
      requiredContexts: ["anthropic"],
    });
  });

  it("drops structured detail and uses the valid title", async () => {
    const error = await requestError(problemResponse({
      type: "about:blank",
      title: "Gateway request failed",
      status: "502",
      detail: {
        provider: "upstream-provider",
        payload: { secret: "must-not-leak" },
      },
      code: ["INVALID_CODE"],
    }, 502));

    expect(error.message).toBe("Gateway request failed");
    expect(error.message).not.toContain("[object Object]");
    expect(error.message).not.toContain("upstream-provider");
    expect(error.message).not.toContain("must-not-leak");
    expect(error.problem).toEqual({
      type: "about:blank",
      title: "Gateway request failed",
      status: 502,
    });
  });

  it.each([
    ["array", [{ detail: "raw array payload" }]],
    ["string", "raw string payload"],
    ["number", 503],
    ["boolean", true],
  ])("uses a generic fallback for a non-object %s body", async (_kind, body) => {
    const error = await requestError(problemResponse(body, 503, "Service Unavailable"));

    expect(error.message).toBe("Service Unavailable");
    expect(error.problem).toEqual({
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
    });
  });

  it("normalizes null fields without coercing them into the message", async () => {
    const error = await requestError(problemResponse({
      type: null,
      title: null,
      status: null,
      detail: null,
      code: null,
      instance: null,
      requiredContexts: null,
    }, 429));

    expect(error.message).toBe("Request failed");
    expect(error.message).not.toContain("[object Object]");
    expect(error.problem).toEqual({
      type: "about:blank",
      title: "Request failed",
      status: 429,
      detail: null,
      code: null,
      instance: null,
      requiredContexts: null,
    });
  });

  it("uses a generic fallback for invalid JSON", async () => {
    const error = await requestError(new Response("<html>provider failure</html>", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "content-type": "text/html" },
    }));

    expect(error.message).toBe("Bad Gateway");
    expect(error.message).not.toContain("provider failure");
    expect(error.problem).toEqual({
      type: "about:blank",
      title: "Bad Gateway",
      status: 502,
    });
  });

  it("normalizes directly constructed errors", () => {
    const error = new AnyHarnessError({
      type: null,
      title: { provider: "must-not-leak" },
      status: "500",
      detail: ["must-not-leak"],
    } as unknown as ConstructorParameters<typeof AnyHarnessError>[0]);

    expect(error.message).toBe("Request failed");
    expect(error.problem).toEqual({
      type: "about:blank",
      title: "Request failed",
      status: 500,
    });
  });

  it("keeps caller detail while producing a detached telemetry-safe error", async () => {
    const rawTail = "provider stderr: token=caller-only-secret";
    const error = await requestError(problemResponse({
      type: "about:blank",
      title: "Internal error",
      status: 500,
      detail: `ACP session start failed: ${rawTail}`,
      code: "AGENT_STARTUP_FAILED",
    }, 500));

    const telemetryError = toAnyHarnessTelemetryError(error);

    expect(error.message).toContain(rawTail);
    expect(telemetryError).toBeInstanceOf(Error);
    expect(telemetryError).not.toBe(error);
    expect((telemetryError as Error).message).toBe(
      "AnyHarness request failed (AGENT_STARTUP_FAILED)",
    );
    expect(telemetryError).toMatchObject({
      name: "AnyHarnessError",
      code: "AGENT_STARTUP_FAILED",
      status: 500,
    });
    expect("problem" in (telemetryError as object)).toBe(false);
    expect("cause" in (telemetryError as object)).toBe(false);
    expect((telemetryError as Error).stack).not.toContain(rawTail);
    expect(JSON.stringify(telemetryError)).not.toContain(rawTail);
  });

  it("does not trust an arbitrary problem code in telemetry", () => {
    const rawCode = "provider output must not reach telemetry";
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Internal error",
      status: 500,
      detail: "caller-only detail",
      code: rawCode,
    });

    const telemetryError = toAnyHarnessTelemetryError(error) as Error & { code?: string };

    expect(telemetryError.message).toBe("AnyHarness request failed");
    expect(telemetryError.code).toBeUndefined();
    expect(telemetryError.stack).not.toContain(rawCode);
    expect(JSON.stringify(telemetryError)).not.toContain(rawCode);
  });

  it("removes a wrapping cause chain when it contains an AnyHarness error", () => {
    const rawTail = "provider stderr caller-only detail";
    const cause = new AnyHarnessError({
      type: "about:blank",
      title: "Internal error",
      status: 500,
      detail: rawTail,
      code: "AGENT_STARTUP_FAILED",
    });
    const wrapper = new Error("Failed to open chat", { cause });

    const telemetryError = toAnyHarnessTelemetryError(wrapper);

    expect(telemetryError).not.toBe(wrapper);
    expect((telemetryError as Error).message).toContain("AGENT_STARTUP_FAILED");
    expect("cause" in (telemetryError as object)).toBe(false);
    expect((telemetryError as Error).stack).not.toContain(rawTail);
    expect(JSON.stringify(telemetryError)).not.toContain(rawTail);
  });

  it("parses an exact runtime incident receipt through a wrapping cause chain", async () => {
    const cause = await requestError(problemResponse({
      type: "about:blank",
      title: "Model gated",
      status: 400,
      code: "SESSION_MODEL_GATED",
      instance: "urn:proliferate:anyharness:incident:8fd6ea9a-1246-4ef0-a526-9cc5f86ed960",
    }, 400));
    const wrapper = new Error("Failed to open chat", { cause });

    expect(hasAnyHarnessRuntimeIncidentReceipt(wrapper)).toBe(true);
  });

  it.each([
    ["missing instance", undefined],
    ["null instance", null],
    ["legacy path instance", "/v1/sessions/session-1"],
    [
      "foreign namespace",
      "urn:proliferate:server:incident:8fd6ea9a-1246-4ef0-a526-9cc5f86ed960",
    ],
    ["missing UUID", "urn:proliferate:anyharness:incident:"],
    ["malformed UUID", "urn:proliferate:anyharness:incident:not-a-uuid"],
    [
      "nil UUID",
      "urn:proliferate:anyharness:incident:00000000-0000-0000-0000-000000000000",
    ],
    [
      "UUIDv1",
      "urn:proliferate:anyharness:incident:8fd6ea9a-1246-1ef0-a526-9cc5f86ed960",
    ],
    [
      "non-RFC variant",
      "urn:proliferate:anyharness:incident:8fd6ea9a-1246-4ef0-7526-9cc5f86ed960",
    ],
    [
      "uppercase UUID",
      "urn:proliferate:anyharness:incident:8FD6EA9A-1246-4EF0-A526-9CC5F86ED960",
    ],
    [
      "receipt suffix",
      "urn:proliferate:anyharness:incident:8fd6ea9a-1246-4ef0-a526-9cc5f86ed960?delivered=true",
    ],
  ])("rejects a runtime incident receipt with %s", (_name, instance) => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Request failed",
      status: 400,
      code: "SESSION_MODEL_GATED",
      ...(instance === undefined ? {} : { instance }),
    });

    expect(hasAnyHarnessRuntimeIncidentReceipt(error)).toBe(false);
  });

  it("finds a valid receipt behind a nonmatching AnyHarness error", () => {
    const receipt = new AnyHarnessError({
      type: "about:blank",
      title: "Model gated",
      status: 400,
      code: "SESSION_MODEL_GATED",
      instance: "urn:proliferate:anyharness:incident:8fd6ea9a-1246-4ef0-a526-9cc5f86ed960",
    });
    const outer = new AnyHarnessError({
      type: "about:blank",
      title: "Outer runtime failure",
      status: 500,
      instance: "/legacy/instance",
    }, receipt);

    expect(hasAnyHarnessRuntimeIncidentReceipt(outer)).toBe(true);
  });

  it("fails closed when a receipt-bearing cause chain contains a cycle", () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Model gated",
      status: 400,
      code: "SESSION_MODEL_GATED",
      instance: "urn:proliferate:anyharness:incident:8fd6ea9a-1246-4ef0-a526-9cc5f86ed960",
    });
    (error as Error & { cause?: unknown }).cause = error;

    expect(hasAnyHarnessRuntimeIncidentReceipt(error)).toBe(false);
  });

  it("accepts a receipt within the bounded cause-chain depth", () => {
    let error: Error = runtimeIncidentError();
    for (let depth = 1; depth < 8; depth += 1) {
      error = new Error(`wrapper ${depth}`, { cause: error });
    }

    expect(hasAnyHarnessRuntimeIncidentReceipt(error)).toBe(true);
  });

  it("fails closed when the cause chain exceeds the bounded depth", () => {
    let error: Error = runtimeIncidentError();
    for (let depth = 0; depth < 8; depth += 1) {
      error = new Error(`wrapper ${depth}`, { cause: error });
    }

    expect(hasAnyHarnessRuntimeIncidentReceipt(error)).toBe(false);
  });

  it("fails closed when reading a cause throws", () => {
    const error = runtimeIncidentError();
    Object.defineProperty(error, "cause", {
      configurable: true,
      get() {
        throw new Error("cause access failed");
      },
    });

    expect(() => hasAnyHarnessRuntimeIncidentReceipt(error)).not.toThrow();
    expect(hasAnyHarnessRuntimeIncidentReceipt(error)).toBe(false);
  });

  it("rejects a matching-looking receipt outside an AnyHarness error", () => {
    const error = Object.assign(new Error("foreign failure"), {
      problem: {
        instance: "urn:proliferate:anyharness:incident:8fd6ea9a-1246-4ef0-a526-9cc5f86ed960",
      },
    });

    expect(hasAnyHarnessRuntimeIncidentReceipt(error)).toBe(false);
  });
});

async function requestError(response: Response): Promise<AnyHarnessError> {
  const transport = new AnyHarnessTransport({
    baseUrl: "http://runtime.test",
    fetch: vi.fn(async () => response) as typeof globalThis.fetch,
  });

  try {
    await transport.get("/failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AnyHarnessError);
    return error as AnyHarnessError;
  }

  throw new Error("Expected request to fail");
}

function problemResponse(
  body: unknown,
  status: number,
  statusText = "",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/problem+json" },
  });
}

function runtimeIncidentError(): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "Model gated",
    status: 400,
    code: "SESSION_MODEL_GATED",
    instance: "urn:proliferate:anyharness:incident:8fd6ea9a-1246-4ef0-a526-9cc5f86ed960",
  });
}
