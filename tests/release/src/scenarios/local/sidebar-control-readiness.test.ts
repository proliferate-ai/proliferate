import assert from "node:assert/strict";
import { test } from "node:test";

import type { Locator, Page } from "playwright";

import { waitForSidebarControlReady } from "./sidebar-control-readiness.js";

interface FakeControlOptions {
  topAtCenter: Array<"overlay" | "target">;
  clippingAncestorRight?: number;
}

function fakeCollapsedSidebar(options: FakeControlOptions): {
  page: Page;
  control: Locator;
  calls: string[];
} {
  const calls: string[] = [];
  const clippingAncestorRight = options.clippingAncestorRight;
  const clippingAncestor = clippingAncestorRight === undefined
    ? null
    : {
        clientHeight: 80,
        clientLeft: 0,
        clientTop: 0,
        clientWidth: clippingAncestorRight - 20,
        getBoundingClientRect: () => ({
          left: 20,
          top: 0,
          right: clippingAncestorRight,
          bottom: 80,
          width: clippingAncestorRight - 20,
          height: 80,
        }),
        parentElement: null,
      };
  const target = {
    getBoundingClientRect: () => ({ left: 20, top: 20, right: 120, bottom: 60, width: 100, height: 40 }),
    contains: (node: unknown) => node === target,
    parentElement: clippingAncestor,
  };
  const overlay = {};
  let hitTest = 0;

  const control = {
    waitFor: async () => {
      calls.push("control.waitFor");
    },
    boundingBox: async () => ({ x: 20, y: 20, width: 100, height: 40 }),
    evaluate: async (callback: (node: unknown) => boolean) => {
      calls.push("control.evaluate");
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      Object.assign(globalThis, {
        window: {
          innerWidth: 1024,
          innerHeight: 768,
          getComputedStyle: (element: unknown) => element === clippingAncestor
            ? { overflowX: "hidden", overflowY: "hidden" }
            : { overflowX: "visible", overflowY: "visible" },
        },
        document: {
          elementFromPoint: () => options.topAtCenter[Math.min(hitTest++, options.topAtCenter.length - 1)] === "target"
            ? target
            : overlay,
        },
      });
      try {
        return callback(target);
      } finally {
        Object.assign(globalThis, {
          window: previousWindow,
          document: previousDocument,
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
    waitForTimeout: async () => undefined,
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

  assert.equal(calls.filter((call) => call === "control.evaluate").length, 2);
});

test("does not accept a control clipped by an overflow ancestor", async () => {
  const { page, control } = fakeCollapsedSidebar({
    topAtCenter: ["target"],
    clippingAncestorRight: 70,
  });

  await assert.rejects(
    waitForSidebarControlReady(page, control),
    /sidebar control did not settle into an interactable layout/,
  );
});
