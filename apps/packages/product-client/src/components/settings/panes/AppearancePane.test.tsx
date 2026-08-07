// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The host provider is a self-referencing package export that resolves to the
// built `dist`, which a source-level test never has. Same stub the retired
// sample-block test used.
vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: vi.fn() },
    nativeUi: null,
  }),
}));

/**
 * Regression lock for the Appearance pane's two previews.
 *
 * This replaces the lock that used to sit on `AppearanceSampleBlock`, and it
 * guards the same reported bug: "the code text isn't actually at the code
 * size". The pane exposes two independent ramps — the UI ladder and the
 * readable-code ladder — and these previews are the only place a reader sees
 * both at once, so a preview that resolves to the wrong ramp silently tells
 * them their setting did nothing.
 *
 * What changed is where the contract lives. The previews are now the product's
 * real renderers with canned content rather than lookalike markup, so the lock
 * is that the pane keeps *reaching* those renderers — a future edit that
 * "simplifies" a preview back into hand-written divs would take the ramp
 * wiring with it, and that is exactly the regression. jsdom cannot resolve
 * `var(...)` to a pixel value, so this asserts the semantic classes and
 * custom-property chains each half carries, not computed sizes.
 */

import { AppearancePane } from "#product/components/settings/panes/AppearancePane";

afterEach(cleanup);

describe("AppearancePane previews", () => {
  it("drives the code preview through the readable-code ramp and the mono family", () => {
    const { container } = render(<AppearancePane />);

    // DiffViewer's root carries the pairing; nothing in the pane may override
    // it with a UI-ramp or fixed size.
    const codeRoot = container.querySelector(".text-readable-code");
    expect(codeRoot).not.toBeNull();
    expect(codeRoot?.className).toContain("font-mono");
  });

  it("drives the chat preview through the message ramp, not the UI-chrome ramp", () => {
    const { container } = render(<AppearancePane />);

    // Both transcript renderers opt their prose into --text-message. If a
    // preview stopped going through them this chain would simply be absent.
    const messageScoped = container.querySelectorAll(
      "[class*='--prose-text-size:var(--text-message)']",
    );
    expect(messageScoped.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the canned preview content the settings copy refers to", () => {
    const { getByText, getAllByText } = render(<AppearancePane />);

    expect(getByText(/Move this workspace to the cloud/)).toBeTruthy();
    // The addition side of the drawn diff, plus the same branch name as inline
    // code in the chat preview, hence getAll.
    expect(getAllByText(/pablo\/ui/).length).toBeGreaterThanOrEqual(2);
  });

  it("offers a theme card per color mode with radio semantics", () => {
    const { getByRole } = render(<AppearancePane />);

    const group = getByRole("radiogroup", { name: "Theme" });
    expect(group.querySelectorAll("[role='radio']").length).toBe(3);
  });

  it("keeps every preview size off hardcoded pixels", () => {
    const { container } = render(<AppearancePane />);

    // The whole point of the ramps is that no element opts out of them. A
    // literal font-size anywhere in the pane is the bypass this guards.
    for (const element of container.querySelectorAll<HTMLElement>("[style]")) {
      expect(element.getAttribute("style")).not.toMatch(/font-size:\s*\d/);
    }
  });
});
