// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { chainVerticalWheelScroll } from "@proliferate/ui/utils/scroll-chain";

describe("chainVerticalWheelScroll", () => {
  it("scrolls the parent when the child reaches the bottom edge", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.style.overflowY = "auto";
    parent.appendChild(child);
    document.body.appendChild(parent);
    setScrollMetrics(parent, { clientHeight: 100, scrollHeight: 500, scrollTop: 10 });
    setScrollMetrics(child, { clientHeight: 100, scrollHeight: 300, scrollTop: 200 });

    const chained = chainVerticalWheelScroll(child, 40);

    expect(chained).toBe(true);
    expect(parent.scrollTop).toBe(50);
  });

  it("does not chain while the child can still scroll", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.style.overflowY = "auto";
    parent.appendChild(child);
    document.body.appendChild(parent);
    setScrollMetrics(parent, { clientHeight: 100, scrollHeight: 500, scrollTop: 10 });
    setScrollMetrics(child, { clientHeight: 100, scrollHeight: 300, scrollTop: 50 });

    const chained = chainVerticalWheelScroll(child, 40);

    expect(chained).toBe(false);
    expect(parent.scrollTop).toBe(10);
  });
});

function setScrollMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: metrics.scrollTop,
  });
}
