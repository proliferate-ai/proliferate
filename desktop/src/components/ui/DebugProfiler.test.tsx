import { Fragment, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DebugProfiler } from "@/components/ui/DebugProfiler";

describe("DebugProfiler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns children without a Profiler wrapper when disabled", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "0");
    const rendered = DebugProfiler({
      id: "workspace-shell",
      children: "child",
    }) as ReactElement;

    expect(rendered.type).toBe(Fragment);
  });
});
