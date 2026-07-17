import { describe, expect, it, vi } from "vitest";

import {
  AnyHarnessError,
  AnyHarnessTransport,
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
