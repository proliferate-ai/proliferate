import { Fragment, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { DebugProfiler } from "@/components/ui/DebugProfiler";

describe("DebugProfiler", () => {
  it("returns children without a Profiler wrapper when disabled", () => {
    const rendered = DebugProfiler({
      id: "workspace-shell",
      children: "child",
    }) as ReactElement;

    expect(rendered.type).toBe(Fragment);
  });
});
