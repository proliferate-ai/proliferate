// @vitest-environment jsdom

// Ack-gated onboarding "setting up" card (agent-auth.md, Proof C7): visible
// exactly while the step reads "settingUp"; every terminal state removes it
// with no error rendering.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeOnboardingCards } from "#product/components/home/screen/HomeOnboardingCards";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import type {
  HomeOnboardingCardModel,
  HomeReadinessCardModel,
} from "#product/lib/domain/home/home-screen";
import type {
  AuthSetupEvidence,
  OnboardingAgentBadge,
} from "#product/lib/domain/agents/auth-setup-badges";

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

function badge(
  overrides: Partial<OnboardingAgentBadge> = {},
): OnboardingAgentBadge {
  return {
    harnessKind: "claude",
    displayName: "Claude Code",
    phase: "ready",
    label: "Usable",
    tone: "success",
    pending: false,
    terminal: true,
    launchable: true,
    actionLabel: null,
    nextAttemptAt: null,
    lastFailureDetail: null,
    ...overrides,
  };
}

function evidence(badges: OnboardingAgentBadge[]): AuthSetupEvidence {
  return { badges, done: false };
}

afterEach(() => {
  cleanup();
});

function readinessCard(
  overrides: Partial<HomeReadinessCardModel> = {},
): HomeReadinessCardModel {
  return {
    agentKind: "grok",
    title: "Grok is ready.",
    description: "You can start now. Claude and 3 others are still installing.",
    ...overrides,
  };
}

describe("HomeOnboardingCards auth-setup step", () => {
  it("renders the setting-up card while the step is pending", () => {
    renderCards({ authSetup: "settingUp" });

    expect(screen.getAllByText(HOME_SCREEN_LABELS.authSetupTitle).length).toBeGreaterThan(0);
    expect(
      screen.getByText(HOME_SCREEN_LABELS.authSetupDescription),
    ).toBeTruthy();
  });

  it("renders no spinner on the setting-up card (frame + ThinkingText title survive, the spinner does not)", () => {
    const { container } = renderCards({ authSetup: "settingUp" });

    expect(container.querySelector("[data-loading-spinner]")).toBeNull();
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

  it("keeps the 3-card cap with the evidence card leading", () => {
    renderCards({
      authSetupEvidence: evidence([badge({ harnessKind: "claude" })]),
      cards: [
        card("add-repository"),
        card("agent-defaults"),
        card("repository-settings"),
      ],
    });
    expect(screen.getByText("title-add-repository")).toBeTruthy();
    expect(screen.getByText("title-agent-defaults")).toBeTruthy();
    expect(screen.queryByText("title-repository-settings")).toBeNull();
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

describe("HomeOnboardingCards evidence-bound card (rung 7)", () => {
  it("renders the evidence card with a badge per adopted agent", () => {
    renderCards({
      authSetupEvidence: evidence([
        badge({ harnessKind: "claude", displayName: "Claude Code", label: "Usable" }),
        badge({
          harnessKind: "codex",
          displayName: "Codex",
          phase: "installing",
          label: "Installing",
          tone: "neutral",
          pending: true,
          terminal: false,
          launchable: false,
        }),
      ]),
    });
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Usable")).toBeTruthy();
    expect(screen.getByText("Installing")).toBeTruthy();
  });

  it("renders a next-action affordance for an actionable terminal state", () => {
    const onOpenAgents = vi.fn();
    renderCards({
      authSetupEvidence: evidence([
        badge({
          harnessKind: "codex",
          displayName: "Codex",
          phase: "actionable",
          label: "Installed",
          tone: "neutral",
          pending: false,
          terminal: true,
          launchable: false,
          actionLabel: "Log in or paste a key",
        }),
      ]),
      onOpenAgents,
    });
    const affordance = screen.getByText("Log in or paste a key");
    affordance.click();
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });

  it("routes a null-action terminal (unsupported) to the pane fallback, never a dead end", () => {
    renderCards({
      authSetupEvidence: evidence([
        badge({
          harnessKind: "cursor",
          displayName: "Cursor",
          phase: "actionable",
          label: "Unsupported",
          tone: "neutral",
          pending: false,
          terminal: true,
          launchable: false,
          actionLabel: null,
        }),
      ]),
    });
    expect(screen.getByText(HOME_SCREEN_LABELS.authSetupOpenAgents)).toBeTruthy();
  });

  it("shows a backoff row's next attempt and failure detail VISIBLY instead of an eternal spinner", () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    const { container } = renderCards({
      authSetupEvidence: evidence([
        badge({
          harnessKind: "grok",
          displayName: "Grok",
          phase: "backoff",
          label: "Unavailable",
          tone: "warning",
          pending: false,
          terminal: true,
          launchable: false,
          actionLabel: "Top up or retry",
          nextAttemptAt: future,
          lastFailureDetail: "429 rate limited",
        }),
      ]),
    });
    const line = container.querySelector<HTMLElement>(
      "[data-agent-onboarding-next-attempt]",
    );
    expect(line).toBeTruthy();
    // Not sr-only: the line is visible text carrying both the countdown and
    // the failure detail.
    expect(line?.className).not.toContain("sr-only");
    expect(line?.textContent).toContain("Next attempt in");
    expect(line?.textContent).toContain("429 rate limited");
    // A terminal backoff row shows no spinner.
    expect(container.querySelector('[data-agent-onboarding-phase="backoff"] .animate-spin')).toBeNull();
  });

  it("renders nothing when the evidence card has no badges", () => {
    const { container } = renderCards({
      authSetupEvidence: { badges: [], done: false },
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("HomeOnboardingCards readiness card (replaces the deleted model-probe card)", () => {
  it("renders nothing when there is no readiness model (probe card is gone, not hidden)", () => {
    const { container } = renderCards();
    expect(container.innerHTML).toBe("");
  });

  it("renders the bound title and description plainly (no ThinkingText, no dismiss)", () => {
    const { container } = renderCards({
      readinessCard: readinessCard({
        title: "Grok is ready.",
        description: "You can start now. Claude and 3 others are still installing.",
      }),
    });

    expect(screen.getByText("Grok is ready.")).toBeTruthy();
    expect(
      screen.getByText("You can start now. Claude and 3 others are still installing."),
    ).toBeTruthy();
    // No dismiss affordance — the readiness card is not dismissible.
    expect(container.querySelector('[aria-label^="Dismiss"]')).toBeNull();
  });

  it("unmounts entirely (caller passes null/undefined) once the install job resolves — no 'done' card", () => {
    const { container, rerender } = render(
      <HomeOnboardingCards
        cards={[]}
        isAddingRepo={false}
        onSelect={vi.fn()}
        readinessCard={readinessCard()}
      />,
    );
    expect(screen.getByText("Grok is ready.")).toBeTruthy();

    rerender(
      <HomeOnboardingCards
        cards={[]}
        isAddingRepo={false}
        onSelect={vi.fn()}
        readinessCard={null}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("takes the last of the 3 card slots, after setup cards", () => {
    renderCards({
      authSetup: "settingUp",
      cards: [card("add-repository"), card("agent-defaults")],
      readinessCard: readinessCard(),
    });

    expect(screen.getAllByText(HOME_SCREEN_LABELS.authSetupTitle).length).toBeGreaterThan(0);
    expect(screen.getByText("title-add-repository")).toBeTruthy();
    expect(screen.getByText("Grok is ready.")).toBeTruthy();
  });
});
