// @vitest-environment jsdom

// Ack-gated onboarding "setting up" card (agent-auth.md, Proof C7): visible
// exactly while the step reads "settingUp"; every terminal state removes it
// with no error rendering.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeOnboardingCards } from "#product/components/home/screen/HomeOnboardingCards";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import type { HomeOnboardingCardModel } from "#product/lib/domain/home/home-screen";

function card(id: HomeOnboardingCardModel["id"]): HomeOnboardingCardModel {
  return {
    id,
    title: `title-${id}`,
    description: `description-${id}`,
    icon: "settings",
  };
}

function renderCards(
  props: Partial<Parameters<typeof HomeOnboardingCards>[0]> = {},
) {
  return render(
    <HomeOnboardingCards
      cards={[]}
      isAddingRepo={false}
      onSelect={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("HomeOnboardingCards auth-setup step", () => {
  it("renders the setting-up card while the step is pending", () => {
    renderCards({ authSetup: "settingUp" });

    expect(screen.getAllByText(HOME_SCREEN_LABELS.authSetupTitle).length).toBeGreaterThan(0);
    expect(
      screen.getByText(HOME_SCREEN_LABELS.authSetupDescription),
    ).toBeTruthy();
  });

  it.each(["hidden", "applied", "advanced"] as const)(
    "renders nothing for the %s step state",
    (state) => {
      const { container } = renderCards({ authSetup: state });
      expect(container.innerHTML).toBe("");
    },
  );

  it("renders nothing when the step is absent (mocked facades)", () => {
    const { container } = renderCards();
    expect(container.innerHTML).toBe("");
  });

  it("keeps the 3-card cap with the setting-up card leading", () => {
    renderCards({
      authSetup: "settingUp",
      cards: [
        card("add-repository"),
        card("agent-defaults"),
        card("repository-settings"),
      ],
    });

    expect(screen.getAllByText(HOME_SCREEN_LABELS.authSetupTitle).length).toBeGreaterThan(0);
    expect(screen.getByText("title-add-repository")).toBeTruthy();
    expect(screen.getByText("title-agent-defaults")).toBeTruthy();
    expect(screen.queryByText("title-repository-settings")).toBeNull();
  });
});
