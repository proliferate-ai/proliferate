import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { GitHub, Settings, SlidersHorizontal, Spinner, X } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { HOME_SCREEN_LABELS } from "@/copy/home/home-screen-copy";
import type {
  HomeModelProbeCardState,
  HomeOnboardingCardModel,
  HomeOnboardingIcon,
} from "@/lib/domain/home/home-screen";

function resolveOnboardingIcon(icon: HomeOnboardingIcon) {
  switch (icon) {
    case "github":
      return <GitHub className="size-4" />;
    case "settings":
      return <Settings className="size-4" />;
    case "sliders":
      return <SlidersHorizontal className="size-4" />;
  }
}

/**
 * Onboarding card (UX spec §10, owner rev 2026-07-01: cards, not rows):
 * side-by-side tile — card surface (bg-card, 12px radius, 1px border),
 * icon row on top with trailing accessories + hover dismiss, then
 * title 13/500 and description 12px muted below.
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
    <div className="group relative flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-accent">
      {onSelect ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          loading={loading}
          aria-label={selectLabel}
          onClick={onSelect}
          className="absolute inset-0 z-0 rounded-xl"
        />
      ) : null}
      <span className={`pointer-events-none z-10 flex items-center gap-1.5 ${onDismiss ? "pr-5" : ""}`}>
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
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
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label={`Dismiss: ${selectLabel}`}
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          className="absolute right-3 top-3 z-20 flex size-4 transform-gpu items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity duration-150 will-change-[opacity] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
      <span className="pointer-events-none z-10 flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-[18px] text-foreground">
          {title}
        </span>
        {description ? (
          <span className="line-clamp-2 text-[12px] leading-[16px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </div>
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
            ? <ProviderIcon kind={state.harnessKinds[0]} className="size-4" />
            : <Spinner className="size-3.5" />
        }
        title={(
          <ThinkingText
            text={HOME_SCREEN_LABELS.modelProbeProbingTitle}
            className="text-[13px] font-medium"
          />
        )}
        trailing={<Spinner className="size-3.5 text-muted-foreground" />}
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
            ? <ProviderIcon kind={state.harnessKinds[0]} className="size-4" />
            : <Settings className="size-4" />
        }
        title={title}
        description={HOME_SCREEN_LABELS.modelProbeDoneDescription}
        trailing={
          state.harnessKinds.length > 1 ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              {state.harnessKinds.slice(1, 4).map((kind) => (
                <ProviderIcon key={kind} kind={kind} className="size-3.5" />
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
      icon={<Settings className="size-4" />}
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
  modelProbe,
  onOpenAgents,
  onDismissModelProbe,
}: {
  cards: HomeOnboardingCardModel[];
  isAddingRepo: boolean;
  onSelect: (card: HomeOnboardingCardModel) => void;
  modelProbe?: HomeModelProbeCardState;
  onOpenAgents?: () => void;
  onDismissModelProbe?: () => void;
}) {
  const hasProbeCard = modelProbe !== undefined && modelProbe.kind !== "hidden";
  if (cards.length === 0 && !hasProbeCard) {
    return null;
  }

  // Max 3 cards (spec §10): setup cards take priority, probe card fills last.
  const visibleCards = cards.slice(0, hasProbeCard ? 2 : 3);

  return (
    <div className="mt-4 grid w-full grid-cols-1 gap-2 empty:hidden sm:grid-cols-3">
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
