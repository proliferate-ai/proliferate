import assert from "node:assert/strict";
import { test } from "node:test";

import type { Locator, Page } from "playwright";

import { waitForSidebarControlReady } from "./sidebar-control-readiness.js";

interface FakeControlOptions {
  topAtCenter: Array<"overlay" | "target">;
}

function fakeCollapsedSidebar(options: FakeControlOptions): {
  page: Page;
  control: Locator;
  calls: string[];
} {
  const calls: string[] = [];
  const target = {
    getBoundingClientRect: () => ({ left: 20, top: 20, right: 120, bottom: 60, width: 100, height: 40 }),
    contains: (node: unknown) => node === target,
  };
  const overlay = {};
  let hitTest = 0;

  const control = {
    waitFor: async () => {
      calls.push("control.waitFor");
    },
    evaluate: async (callback: (node: unknown, args: unknown) => Promise<void>, args: unknown) => {
      calls.push("control.evaluate");
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      const previousPerformance = globalThis.performance;
      const previousRaf = globalThis.requestAnimationFrame;
      let now = 0;
      Object.assign(globalThis, {
        window: { innerWidth: 1024, innerHeight: 768 },
        document: {
          elementFromPoint: () => options.topAtCenter[Math.min(hitTest++, options.topAtCenter.length - 1)] === "target"
            ? target
            : overlay,
        },
        performance: { now: () => now },
        requestAnimationFrame: (run: (timestamp: number) => void) => {
          now += 50;
          run(now);
          return now;
        },
      });
      try {
        await callback(target, args);
      } finally {
        Object.assign(globalThis, {
          window: previousWindow,
          document: previousDocument,
          performance: previousPerformance,
          requestAnimationFrame: previousRaf,
        });
      }
    },
  } as unknown as Locator;

  const hide = {
    first: () => hide,
    waitFor: async () => {
      calls.push("hide.waitFor");
    },
  };
  const combined = {
    first: () => combined,
    waitFor: async () => {
      calls.push("toggle.waitFor");
    },
  };
  const show = {
    first: () => show,
    or: () => combined,
    isVisible: async () => true,
    click: async () => {
      calls.push("show.click");
    },
  };
  const page = {
    getByRole: (_role: string, query: { name: string }) => query.name === "Show sidebar" ? show : hide,
  } as unknown as Page;

  return { page, control, calls };
}

test("expands the sidebar and proves the control is settled before returning", async () => {
  const { page, control, calls } = fakeCollapsedSidebar({ topAtCenter: ["target"] });

  await waitForSidebarControlReady(page, control);

  assert.deepEqual(calls, [
    "toggle.waitFor",
    "show.click",
    "hide.waitFor",
    "control.waitFor",
    "control.evaluate",
  ]);
});

test("does not accept stable geometry while an overlay owns the hit target", async () => {
  const { page, control, calls } = fakeCollapsedSidebar({ topAtCenter: ["overlay", "target"] });

  await waitForSidebarControlReady(page, control);

  assert.equal(calls.filter((call) => call === "control.evaluate").length, 1);
});
