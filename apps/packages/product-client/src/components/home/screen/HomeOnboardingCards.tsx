import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { GitHub } from "#product/primitives/icons/platform";
import { Settings, SlidersHorizontal, X } from "#product/primitives/icons/core";
import { Spinner } from "#product/primitives/Spinner";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import type {
  HomeModelProbeCardState,
  HomeOnboardingCardModel,
  HomeOnboardingIcon,
} from "#product/lib/domain/home/home-screen";
import type { AuthSetupStepState } from "#product/lib/domain/agents/auth-onboarding";

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
 * Onboarding card (UX spec §10, owner rev 2026-07-01: cards, not rows):
 * side-by-side tile — page-tone surface, 20px radius, hairline frame,
 * icon row on top with trailing accessories + hover dismiss, then
 * title 13/500 and description 12px muted below. The frame is a real
 * border, not a ring: WKWebView clips hairline ring shadows against the
 * pixel-snapped background, so at fractional page zooms whole edges of a
 * 0.5px ring disappear, while non-zero borders always paint at least one
 * device pixel (PRO-117).
 */
function OnboardingCard({
  icon,
  title,
  description,
  trailing,
  loading = false,
  onSelect,
  onDismiss,
  selectLabel,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
  onSelect?: () => void;
  onDismiss?: () => void;
  selectLabel: string;
}) {
  return (
    <div className="group relative flex min-h-26 min-w-0 flex-col rounded-composer border-[0.5px] border-border-heavy bg-background px-4 py-3 text-left shadow-subtle transition-colors hover:bg-hover active:bg-active">
      {onSelect ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          loading={loading}
          aria-label={selectLabel}
          onClick={onSelect}
          className="absolute inset-0 z-0 rounded-composer"
        />
      ) : null}
      <span className={`pointer-events-none z-10 flex items-center gap-1.5 ${onDismiss ? "pr-9" : ""}`}>
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground [&_svg]:icon-control">
          {icon}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {trailing}
        </span>
      </span>
      {onDismiss ? (
        // Out of flow (absolute) so it fades in place, and transform-gpu +
        // will-change keep it on a persistent compositing layer — otherwise
        // WKWebView promotes/demotes the layer around the opacity transition
        // and the glyph re-snaps to the pixel grid (subtle down-right drift).
        <RowActionIconButton
          label={`Dismiss: ${selectLabel}`}
          onClick={onDismiss}
          className="absolute right-2 top-2 z-20 rounded-full transform-gpu will-change-[opacity]"
        >
          <X />
        </RowActionIconButton>
      ) : null}
      <span className="pointer-events-none z-10 mt-auto flex min-h-10 min-w-0 flex-col justify-end gap-0.5">
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
    <OnboardingCard
      icon={<Settings className="icon-paired" />}
      title={(
        <ThinkingText
          text={HOME_SCREEN_LABELS.authSetupTitle}
          className="text-ui font-medium"
        />
      )}
      description={HOME_SCREEN_LABELS.authSetupDescription}
      trailing={<Spinner className="icon-paired text-muted-foreground" />}
      selectLabel={HOME_SCREEN_LABELS.authSetupTitle}
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
      <OnboardingCard
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
        selectLabel={HOME_SCREEN_LABELS.modelProbeProbingTitle}
      />
    );
  }

  if (state.kind === "done") {
    const title = state.modelCount === 1
      ? "1 model available"
      : `${state.modelCount} models available`;
    return (
      <OnboardingCard
        icon={
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
        onSelect={onOpenAgents}
        onDismiss={onDismiss}
        selectLabel={title}
      />
    );
  }

  return (
    <OnboardingCard
      icon={<Settings className="icon-paired" />}
      title={HOME_SCREEN_LABELS.modelProbeNoneTitle}
      description={HOME_SCREEN_LABELS.modelProbeNoneDescription}
      onSelect={onOpenAgents}
      onDismiss={onDismiss}
      selectLabel={HOME_SCREEN_LABELS.modelProbeNoneTitle}
    />
  );
}

export function HomeOnboardingCards({
  cards,
  isAddingRepo,
  onSelect,
  authSetup,
  modelProbe,
  onOpenAgents,
  onDismissModelProbe,
}: {
  cards: HomeOnboardingCardModel[];
  isAddingRepo: boolean;
  onSelect: (card: HomeOnboardingCardModel) => void;
  authSetup?: AuthSetupStepState;
  modelProbe?: HomeModelProbeCardState;
  onOpenAgents?: () => void;
  onDismissModelProbe?: () => void;
}) {
  const hasAuthSetupCard = authSetup === "settingUp";
  const hasProbeCard = modelProbe !== undefined && modelProbe.kind !== "hidden";
  if (cards.length === 0 && !hasProbeCard && !hasAuthSetupCard) {
    return null;
  }

  // Max 3 cards (spec §10): the transient auth-setup step leads, setup cards
  // take priority over the probe card, which fills last.
  const reservedSlots = (hasAuthSetupCard ? 1 : 0) + (hasProbeCard ? 1 : 0);
  const visibleCards = cards.slice(0, 3 - reservedSlots);

  return (
    <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3 empty:hidden">
      {hasAuthSetupCard && authSetup ? <AuthSetupCard state={authSetup} /> : null}
      {visibleCards.map((card) => (
        <OnboardingCard
          key={card.id}
          icon={resolveOnboardingIcon(card.icon)}
          title={card.title}
          description={card.description}
          loading={card.id === "add-repository" && isAddingRepo}
          onSelect={() => onSelect(card)}
          selectLabel={card.title}
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
