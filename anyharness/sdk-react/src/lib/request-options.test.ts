import { describe, expect, it } from "vitest";
import { requestOptionsWithSignal } from "./request-options.js";

describe("sdk-react request options", () => {
  it("uses the query signal when no caller signal is provided", () => {
    const queryController = new AbortController();

    const options = requestOptionsWithSignal(undefined, queryController.signal);

    expect(options.signal).toBe(queryController.signal);
  });

  it("composes query and caller signals so either can abort", () => {
    const queryController = new AbortController();
    const callerController = new AbortController();

    const options = requestOptionsWithSignal({
      headers: { "x-test": "1" },
      signal: callerController.signal,
    }, queryController.signal);

    expect(options.headers).toEqual({ "x-test": "1" });
    expect(options.signal).not.toBe(callerController.signal);
    expect(options.signal).not.toBe(queryController.signal);

    queryController.abort("query-cancelled");
    expect(options.signal?.aborted).toBe(true);
  });

  it("lets caller cancellation abort the composed signal", () => {
    const queryController = new AbortController();
    const callerController = new AbortController();

    const options = requestOptionsWithSignal({
      signal: callerController.signal,
    }, queryController.signal);

    callerController.abort("caller-cancelled");
    expect(options.signal?.aborted).toBe(true);
  });
});
