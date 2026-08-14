import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { APPEARANCE_SIZE_IDS, READABLE_CODE_FONT_SCALES } from "#product/lib/domain/preferences/appearance";
import { TERMINAL_LINE_HEIGHT } from "#product/lib/domain/terminals/terminal-grid";
import {
  createSettledResizeReporter,
  resolveXtermSurfaceTypography,
  recordXtermInitializationFailure,
  XTERM_CURSOR_OPTIONS,
  XTERM_RESIZE_REPORT_SETTLE_MS,
} from "#product/hooks/terminals/lifecycle/use-xterm-surface";

afterEach(() => {
  resetRendererDiagnosticsSinkForTest();
});

describe("xterm cursor contract", () => {
  it("uses the same one-pixel bar geometry as composed text editors", () => {
    expect(XTERM_CURSOR_OPTIONS).toEqual({
      cursorStyle: "bar",
      cursorWidth: 1,
    });
  });
});

describe("resolveXtermSurfaceTypography", () => {
  it.each(APPEARANCE_SIZE_IDS)("derives readable-code terminal geometry for %s", (sizeId) => {
    const typography = resolveXtermSurfaceTypography(sizeId);

    expect(typography.fontSize).toBeGreaterThan(0);
    expect(typography.lineHeight).toBe(TERMINAL_LINE_HEIGHT);
    expect(typography.fontSize * typography.lineHeight).toBeGreaterThan(typography.fontSize);
  });

  it("renders the Small readable-code preset at an unscaled size with terminal row cadence", () => {
    expect(resolveXtermSurfaceTypography("small")).toEqual({
      fontSize: READABLE_CODE_FONT_SCALES.small.monacoFontSize,
      lineHeight: TERMINAL_LINE_HEIGHT,
    });
  });

  it("preserves explicit caller overrides", () => {
    const overrideFontSize = READABLE_CODE_FONT_SCALES.xxxlarge.monacoFontSize;
    expect(resolveXtermSurfaceTypography("default", { fontSize: overrideFontSize, lineHeight: 1.25 }))
      .toEqual({ fontSize: overrideFontSize, lineHeight: 1.25 });
  });
});

describe("createSettledResizeReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the final size exactly once after a per-column drag storm settles", () => {
    const report = vi.fn();
    const reporter = createSettledResizeReporter(report);

    // A separator drag emits one grid size per column change.
    for (let cols = 120; cols >= 80; cols -= 1) {
      reporter.observe({ cols, rows: 40 });
      vi.advanceTimersByTime(30);
    }
    expect(report).not.toHaveBeenCalled();

    vi.advanceTimersByTime(XTERM_RESIZE_REPORT_SETTLE_MS);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ cols: 80, rows: 40 });
  });

  it("reports a lone resize after the settle delay", () => {
    const report = vi.fn();
    const reporter = createSettledResizeReporter(report);

    reporter.observe({ cols: 100, rows: 30 });
    vi.advanceTimersByTime(XTERM_RESIZE_REPORT_SETTLE_MS);
    expect(report).toHaveBeenCalledWith({ cols: 100, rows: 30 });
  });

  it("cancel drops a pending report on dispose", () => {
    const report = vi.fn();
    const reporter = createSettledResizeReporter(report);

    reporter.observe({ cols: 100, rows: 30 });
    reporter.cancel();
    vi.advanceTimersByTime(XTERM_RESIZE_REPORT_SETTLE_MS * 2);
    expect(report).not.toHaveBeenCalled();
  });
});

describe("xterm initialization diagnostics", () => {
  it("captures the exact failure name and classification", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });

    recordXtermInitializationFailure("TerminalViewport", new TypeError("failed"));

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderer.terminal.xterm_init_failed",
      errorClassification: "xterm_init_failed",
    }));
  });
});
