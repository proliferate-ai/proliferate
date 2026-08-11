import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getFetchDiagnosticTotals,
  installBootDiagnosticsFetchProbe,
  resetBootDiagnosticsFetch,
  uninstallBootDiagnosticsFetchProbe,
} from "./boot-stall-diagnostics-fetch";
import { INTERNAL_RENDERER_DIAGNOSTICS_INGEST_URL } from "./boot-stall-diagnostics-types";

describe("boot diagnostics fetch probe", () => {
  afterEach(() => {
    uninstallBootDiagnosticsFetchProbe();
    resetBootDiagnosticsFetch();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("bypasses renderer ingest before sequence, summary, or diagnostic work", async () => {
    const originalFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const recordBootDiagnostic = vi.fn();
    const getNextSeq = vi.fn(() => 7);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { fetch: originalFetch },
    });

    installBootDiagnosticsFetchProbe({ recordBootDiagnostic, getNextSeq });
    await window.fetch(INTERNAL_RENDERER_DIAGNOSTICS_INGEST_URL);

    expect(originalFetch).toHaveBeenCalledWith(
      INTERNAL_RENDERER_DIAGNOSTICS_INGEST_URL,
      undefined,
    );
    expect(getNextSeq).not.toHaveBeenCalled();
    expect(recordBootDiagnostic).not.toHaveBeenCalled();
    expect(getFetchDiagnosticTotals()).toEqual({
      starts: 0,
      ends: 0,
      errors: 0,
      inFlight: 0,
    });

    await window.fetch("https://example.test/ordinary");
    expect(getNextSeq).toHaveBeenCalledOnce();
    expect(recordBootDiagnostic).toHaveBeenCalledWith(
      "fetch.start",
      expect.objectContaining({ requestSeq: 7 }),
    );
    expect(recordBootDiagnostic).toHaveBeenCalledWith(
      "fetch.end",
      expect.objectContaining({ requestSeq: 7, status: 204 }),
    );
    expect(getFetchDiagnosticTotals()).toEqual({
      starts: 1,
      ends: 1,
      errors: 0,
      inFlight: 0,
    });
  });
});
