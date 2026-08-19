import type { ReactNode } from "react";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { GitHub } from "#product/primitives/icons/platform";
import { Settings, SlidersHorizontal, X } from "#product/primitives/icons/core";
import { Spinner } from "#product/primitives/Spinner";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { ActionCard } from "#product/primitives/patterns/ActionCard";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import type {
  HomeModelProbeCardState,
  HomeOnboardingCardModel,
  HomeOnboardingIcon,
} from "#product/lib/domain/home/home-screen";
import type { AuthSetupStepState } from "#product/lib/domain/agents/auth-onboarding";
import type { AuthSetupEvidence } from "#product/lib/domain/agents/auth-setup-badges";
import { AuthSetupEvidenceCard } from "#product/components/home/screen/HomeOnboardingEvidenceCard";

function resolveOnboardingIcon(icon: HomeOnboardingIcon) {
  switch (icon) {
    case "github":
      return <GitHub className="icon-paired" />;
    case "settings":
      return <Settings className="icon-paired" />;
    case "sliders":
      return <SlidersHorizontal className="icon-paired" />;
  }
}

/**
 * Noninteractive onboarding status tile. It retains the actionable cards'
 * established frame and content anatomy, while `ActionCard` owns primary and
 * dismiss controls. The ring utilities are the Web frame; on desktop the
 * unlayered zoom-stable-hairline-frame rule repaints it at exactly one physical
 * device pixel because WKWebView can drop sub-device-pixel edges (PRO-117).
 */
function OnboardingStatusCard({
  icon,
  title,
  description,
  trailing,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-26 min-w-0 flex-col rounded-composer bg-background px-4 py-3 text-left shadow-subtle ring-[0.5px] ring-border-heavy zoom-stable-hairline-frame transition-colors hover:bg-hover active:bg-active">
      <span className="pointer-events-none z-raised flex items-center gap-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground [&_svg]:icon-control">
          {icon}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {trailing}
        </span>
      </span>
      <span className="pointer-events-none z-raised mt-auto flex min-h-10 min-w-0 flex-col justify-end gap-0.5">
        <span className="truncate text-body font-medium text-foreground">
          {title}
        </span>
        {description ? (
          <span className="line-clamp-2 text-ui-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Ack-gated onboarding "setting up" step (agent-auth.md, Proof C7): visible
 * only while the first-run adoption's gateway selections await the runtime's
 * delivery ack (or the enrollment's keys). Resolution or the ~20s grace
 * window removes the card — pending beyond the grace lives on the harness
 * panes' ordinary indicator, never here, and there is no error state.
 */
function AuthSetupCard({ state }: { state: AuthSetupStepState }) {
  if (state !== "settingUp") {
    return null;
  }
  return (
    <OnboardingStatusCard
      icon={<Settings className="icon-paired" />}
      title={(
        <ThinkingText
          text={HOME_SCREEN_LABELS.authSetupTitle}
          className="text-ui font-medium"
        />
      )}
      description={HOME_SCREEN_LABELS.authSetupDescription}
      trailing={<Spinner className="icon-paired text-muted-foreground" />}
    />
  );
}

function ModelProbeCard({
  state,
  onOpenAgents,
  onDismiss,
}: {
  state: HomeModelProbeCardState;
  onOpenAgents: () => void;
  onDismiss: () => void;
}) {
  if (state.kind === "hidden") {
    return null;
  }

  if (state.kind === "probing") {
    return (
      <OnboardingStatusCard
        icon={
          state.harnessKinds[0]
            ? <ProviderIcon kind={state.harnessKinds[0]} className="icon-paired" />
            : <Spinner className="icon-paired" />
        }
        title={(
          <ThinkingText
            text={HOME_SCREEN_LABELS.modelProbeProbingTitle}
            className="text-ui font-medium"
          />
        )}
        trailing={<Spinner className="icon-paired text-muted-foreground" />}
      />
    );
  }

  if (state.kind === "done") {
    const title = state.modelCount === 1
      ? "1 model available"
      : `${state.modelCount} models available`;
    return (
      <ActionCard
        leading={
          state.harnessKinds[0]
            ? <ProviderIcon kind={state.harnessKinds[0]} className="icon-paired" />
            : <Settings className="icon-paired" />
        }
        title={title}
        description={HOME_SCREEN_LABELS.modelProbeDoneDescription}
        trailing={
          state.harnessKinds.length > 1 ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              {state.harnessKinds.slice(1, 4).map((kind) => (
                <ProviderIcon key={kind} kind={kind} className="icon-paired" />
              ))}
            </span>
          ) : null
        }
        onAction={onOpenAgents}
        secondaryAction={(
          <RowActionIconButton
            label={`Dismiss: ${title}`}
            onClick={onDismiss}
            className="rounded-full transform-gpu will-change-[opacity]"
          >
            <X />
          </RowActionIconButton>
        )}
        actionLabel={title}
      />
    );
  }

  return (
    <ActionCard
      leading={<Settings className="icon-paired" />}
      title={HOME_SCREEN_LABELS.modelProbeNoneTitle}
      description={HOME_SCREEN_LABELS.modelProbeNoneDescription}
      onAction={onOpenAgents}
      secondaryAction={(
        <RowActionIconButton
          label={`Dismiss: ${HOME_SCREEN_LABELS.modelProbeNoneTitle}`}
          onClick={onDismiss}
          className="rounded-full transform-gpu will-change-[opacity]"
        >
          <X />
        </RowActionIconButton>
      )}
      actionLabel={HOME_SCREEN_LABELS.modelProbeNoneTitle}
    />
  );
}

export function HomeOnboardingCards({
  cards,
  isAddingRepo,
  onSelect,
  authSetup,
  authSetupEvidence,
  modelProbe,
  onOpenAgents,
  onDismissModelProbe,
}: {
  cards: HomeOnboardingCardModel[];
  isAddingRepo: boolean;
  onSelect: (card: HomeOnboardingCardModel) => void;
  authSetup?: AuthSetupStepState;
  authSetupEvidence?: AuthSetupEvidence | null;
  modelProbe?: HomeModelProbeCardState;
  onOpenAgents?: () => void;
  onDismissModelProbe?: () => void;
}) {
  // The timer card (flag off) and the evidence card (flag on) are mutually
  // exclusive: the dormant hook yields nothing, so only one is ever truthy.
  const hasAuthSetupCard = authSetup === "settingUp";
  const hasEvidenceCard =
    authSetupEvidence != null && authSetupEvidence.badges.length > 0;
  const hasProbeCard = modelProbe !== undefined && modelProbe.kind !== "hidden";
  if (cards.length === 0 && !hasProbeCard && !hasAuthSetupCard && !hasEvidenceCard) {
    return null;
  }

  // Max 3 cards (spec §10): the transient auth-setup step leads, setup cards
  // take priority over the probe card, which fills last.
  const reservedSlots =
    (hasAuthSetupCard || hasEvidenceCard ? 1 : 0) + (hasProbeCard ? 1 : 0);
  const visibleCards = cards.slice(0, 3 - reservedSlots);

  return (
    <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3 empty:hidden">
      {hasEvidenceCard && authSetupEvidence ? (
        <AuthSetupEvidenceCard
          evidence={authSetupEvidence}
          onOpenAgents={onOpenAgents ?? (() => {})}
        />
      ) : null}
      {hasAuthSetupCard && authSetup ? <AuthSetupCard state={authSetup} /> : null}
      {visibleCards.map((card) => (
        <ActionCard
          key={card.id}
          leading={resolveOnboardingIcon(card.icon)}
          title={card.title}
          description={card.description}
          loading={card.id === "add-repository" && isAddingRepo}
          onAction={() => onSelect(card)}
          actionLabel={card.title}
        />
      ))}
      {hasProbeCard && modelProbe && onOpenAgents && onDismissModelProbe ? (
        <ModelProbeCard
          state={modelProbe}
          onOpenAgents={onOpenAgents}
          onDismiss={onDismissModelProbe}
        />
      ) : null}
    </div>
  );
}
