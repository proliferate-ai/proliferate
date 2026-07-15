// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportMenuAction } from "@/lib/domain/support/support-menu-action";
import type { WebAppTarget } from "@/hooks/capabilities/derived/use-web-app-target";
import { SidebarHelpSection } from "./SidebarHelpSection";

const AVAILABLE_WEB_APP: WebAppTarget = {
  available: true,
  baseUrl: "https://web.proliferate.com",
};
const NO_WEB_APP: WebAppTarget = { available: false, baseUrl: null };

function renderSection(overrides: {
  webApp?: WebAppTarget;
  supportAction?: SupportMenuAction;
  supportDisabledReason?: string | null;
} = {}) {
  const openSupport = vi.fn();
  const openPrompt = vi.fn();
  const openExternalUrl = vi.fn();
  const onShowKeyboardShortcuts = vi.fn();
  const onClose = vi.fn();

  render(
    <SidebarHelpSection
      webApp={overrides.webApp ?? AVAILABLE_WEB_APP}
      supportAction={overrides.supportAction ?? { kind: "vendor" }}
      supportDisabledReason={overrides.supportDisabledReason ?? null}
      openSupport={openSupport}
      openPrompt={openPrompt}
      openExternalUrl={openExternalUrl}
      onShowKeyboardShortcuts={onShowKeyboardShortcuts}
      onClose={onClose}
    />,
  );

  return { openSupport, openPrompt, openExternalUrl, onShowKeyboardShortcuts, onClose };
}

describe("SidebarHelpSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("Docs/Changelog/Discord are always rendered regardless of support kind", () => {
    renderSection({ supportAction: { kind: "none" } });

    // getByRole throws if absent, which is itself the presence assertion.
    expect(screen.getByRole("button", { name: "Docs" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Changelog" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Discord" })).not.toBeNull();
  });

  describe("support routing", () => {
    it("vendor: renders the existing feedback/prompt actions wired to the report window", () => {
      const { openSupport, openPrompt, onClose } = renderSection({
        supportAction: { kind: "vendor" },
      });

      // Exact match would miss the trailing keyboard-shortcut label ("⌘S").
      fireEvent.click(screen.getByRole("button", { name: /^Send feedback/ }));
      expect(openSupport).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Submit a prompt" }));
      expect(openPrompt).toHaveBeenCalledTimes(1);

      expect(screen.queryByRole("button", { name: "Contact support" })).toBeNull();
    });

    it("operator: renders a single action that opens the operator's configured target", () => {
      const { openExternalUrl, onClose } = renderSection({
        supportAction: { kind: "operator", url: "https://acme.example.com/support" },
      });

      expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Submit a prompt" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
      expect(openExternalUrl).toHaveBeenCalledWith("https://acme.example.com/support");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("operator with only an email: opens a mailto: link", () => {
      const { openExternalUrl } = renderSection({
        supportAction: { kind: "operator", url: "mailto:it-help@acme.example.com" },
      });

      fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
      expect(openExternalUrl).toHaveBeenCalledWith("mailto:it-help@acme.example.com");
    });

    it("none: hides the support action entirely instead of disabling it", () => {
      renderSection({ supportAction: { kind: "none" } });

      expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Submit a prompt" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Contact support" })).toBeNull();
    });
  });

  describe("web-app handoff", () => {
    it("renders 'Go to web' when this deployment has a web app", () => {
      renderSection({ webApp: AVAILABLE_WEB_APP });

      // Exact match would miss the trailing keyboard-shortcut label.
      expect(screen.getByRole("button", { name: /^Go to web/ })).not.toBeNull();
    });

    it("hides 'Go to web' entirely when this deployment has no web app", () => {
      renderSection({ webApp: NO_WEB_APP });

      expect(screen.queryByRole("button", { name: /^Go to web/ })).toBeNull();
    });
  });
});
