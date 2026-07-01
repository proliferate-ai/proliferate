import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight, GitHub, Settings, SlidersHorizontal, Spinner, X } from "@proliferate/ui/icons";
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
 * Flat onboarding card row (UX spec §10): 10px radius, 1px border, inline
 * surface (no elevation), icon 16px + title 13/500 + description 12px muted,
 * chevron CTA right, ghost dismiss that fades in on hover.
 */
function OnboardingCardRow({
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
    <div className="group relative flex w-full min-w-0 items-center gap-3 rounded-[10px] border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent">
      {onSelect ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          loading={loading}
          aria-label={selectLabel}
          onClick={onSelect}
          className="absolute inset-0 z-0 rounded-[10px]"
        />
      ) : null}
      <span className="pointer-events-none z-10 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="pointer-events-none z-10 flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium leading-[18px] text-foreground">
          {title}
        </span>
        {description ? (
          <span className="truncate text-xs leading-[18px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <span className="pointer-events-none z-10 flex shrink-0 items-center gap-1.5">
        {trailing}
        {onSelect ? (
          <ChevronRight className="size-3.5 text-faint" />
        ) : null}
      </span>
      {onDismiss ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label={`Dismiss: ${selectLabel}`}
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          className="z-10 flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
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
      <OnboardingCardRow
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
      <OnboardingCardRow
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
    <OnboardingCardRow
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
    <div className="mt-4 flex w-full flex-col gap-2 empty:hidden">
      {visibleCards.map((card) => (
        <OnboardingCardRow
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
