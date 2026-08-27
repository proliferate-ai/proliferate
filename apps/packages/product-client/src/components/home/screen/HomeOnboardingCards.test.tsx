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
    rechecking: false,
    detail: null,
    actionLabel: null,
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

describe("HomeOnboardingCards auth-setup card", () => {
  it("renders nothing when there is no setup card at all", () => {
    const { container } = renderCards();
    expect(container.innerHTML).toBe("");
  });

  it("renders no spinner on the setup card", () => {
    const { container } = renderCards({
      authSetupEvidence: evidence([badge({ harnessKind: "claude" })]),
    });

    expect(container.querySelector("[data-loading-spinner]")).toBeNull();
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

});

describe("HomeOnboardingCards state-bound setup card", () => {
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

  it("shows a stale row's LAST OBSERVATION with a re-checking line, never a spinner", () => {
    const { container } = renderCards({
      authSetupEvidence: evidence([
        badge({
          harnessKind: "grok",
          displayName: "Grok",
          phase: "rechecking",
          // The last observation's own words stay on screen.
          label: "Not authenticated",
          tone: "destructive",
          pending: false,
          terminal: true,
          launchable: false,
          rechecking: true,
          // The DOCUMENT's own marker (founder-ruled 2026-08-27 wording), not a
          // card-local placeholder.
          detail: "last checked 2m ago — retrying",
        }),
      ]),
    });

    expect(screen.getByText("Not authenticated")).toBeTruthy();
    const line = container.querySelector<HTMLElement>(
      "[data-agent-onboarding-rechecking]",
    );
    expect(line).toBeTruthy();
    // Not sr-only: the dimming is visible text, not a hidden hint.
    expect(line?.className).not.toContain("sr-only");
    expect(line?.textContent).toBe("last checked 2m ago — retrying");
    // A stale row is terminal and shows no spinner. Selected on the Spinner's
    // own `data-loading-spinner` hook (D-R13): the old `.animate-spin` selector
    // named a Tailwind class this app's Spinner never emits — it renders
    // `proliferate-spinner` and rotates from a CSS rule — so the assertion
    // matched nothing whether or not a spinner was there.
    expect(
      container.querySelector('[data-agent-onboarding-phase="rechecking"] [data-loading-spinner]'),
    ).toBeNull();
  });

  it("keeps a green row green while it re-checks (the light dims, it never goes out)", () => {
    const { container } = renderCards({
      authSetupEvidence: evidence([
        badge({
          harnessKind: "claude",
          label: "Authenticated",
          rechecking: true,
          // The ruled stale marker (2026-08-27) carries the last observation's
          // age; it rides beside the green badge, never instead of it.
          detail: "last checked 2m ago — retrying",
        }),
      ]),
    });

    expect(screen.getByText("Authenticated")).toBeTruthy();
    expect(screen.getByText("last checked 2m ago — retrying")).toBeTruthy();
    expect(container.querySelector("[data-agent-onboarding-rechecking]")).toBeTruthy();
    // Launchable: nothing to action, so no affordance is offered.
    expect(screen.queryByText(HOME_SCREEN_LABELS.authSetupOpenAgents)).toBeNull();
  });

  it("prints NO diagnostic line when the document supports none", () => {
    // The line the deleted derived summary filled is a sanctioned loss: better an
    // absent line than a constant standing in for a reason we do not hold.
    const { container } = renderCards({
      authSetupEvidence: evidence([
        badge({
          phase: "actionable",
          label: "Not authenticated",
          tone: "destructive",
          launchable: false,
          detail: null,
        }),
      ]),
    });

    expect(container.querySelector("[data-agent-onboarding-detail]")).toBeNull();
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

  it("takes the last of the 3 card slots, after the setup card", () => {
    renderCards({
      authSetupEvidence: evidence([badge({ harnessKind: "claude" })]),
      cards: [card("add-repository"), card("agent-defaults")],
      readinessCard: readinessCard(),
    });

    expect(screen.getAllByText(HOME_SCREEN_LABELS.authSetupTitle).length).toBeGreaterThan(0);
    expect(screen.getByText("title-add-repository")).toBeTruthy();
    expect(screen.getByText("Grok is ready.")).toBeTruthy();
  });
});
