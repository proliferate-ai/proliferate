import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { GitHub } from "#product/primitives/icons/platform";
import { Settings, SlidersHorizontal, X } from "#product/primitives/icons/core";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import type {
  HomeOnboardingCardModel,
  HomeOnboardingIcon,
  HomeReadinessCardModel,
} from "#product/lib/domain/home/home-screen";
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
 * Onboarding card (UX spec §10, owner rev 2026-07-01: cards, not rows):
 * side-by-side tile — page-tone surface, 20px radius, hairline frame,
 * icon row on top with trailing accessories + hover dismiss, then
 * title 13/500 and description 12px muted below. The ring utilities are
 * the Web rendering of the frame; on desktop the unlayered
 * zoom-stable-hairline-frame rule (desktop.css) repaints it at exactly
 * one physical device pixel (--proliferate-device-px), because WKWebView
 * drops sub-device-pixel hairlines to zero on individual edges depending
 * on window zoom, display density, and subpixel position (PRO-117).
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
    <div className="group relative flex min-h-26 min-w-0 flex-col rounded-composer bg-background px-4 py-3 text-left shadow-subtle ring-[0.5px] ring-border-heavy zoom-stable-hairline-frame transition-colors hover:bg-hover active:bg-active">
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
 * Readiness card (UX spec §10 revision, ruling 4): replaces the deleted
 * "Processing your models…" probe card. Plain text throughout (no
 * ThinkingText, no spinner) — something is already ready, so there is
 * nothing left to imply is still "processing" for THIS card. Not
 * dismissible and not a link: it states a fact about readiness and unmounts
 * entirely (owned by the caller) once the install job resolves.
 */
function ReadinessCard({ model }: { model: HomeReadinessCardModel }) {
  return (
    <OnboardingCard
      icon={<ProviderIcon kind={model.agentKind} />}
      title={model.title}
      description={model.description}
      selectLabel={model.title}
    />
  );
}

export function HomeOnboardingCards({
  cards,
  isAddingRepo,
  onSelect,
  authSetupEvidence,
  readinessCard,
  onOpenAgents,
}: {
  cards: HomeOnboardingCardModel[];
  isAddingRepo: boolean;
  onSelect: (card: HomeOnboardingCardModel) => void;
  authSetupEvidence?: AuthSetupEvidence | null;
  readinessCard?: HomeReadinessCardModel | null;
  onOpenAgents?: () => void;
}) {
  const hasEvidenceCard =
    authSetupEvidence != null && authSetupEvidence.badges.length > 0;
  const hasReadinessCard = readinessCard != null;
  if (cards.length === 0 && !hasReadinessCard && !hasEvidenceCard) {
    return null;
  }

  // Max 3 cards (spec §10): the transient auth-setup card leads, setup cards
  // take priority over the readiness card, which fills last.
  const reservedSlots = (hasEvidenceCard ? 1 : 0) + (hasReadinessCard ? 1 : 0);
  const visibleCards = cards.slice(0, 3 - reservedSlots);

  return (
    <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3 empty:hidden">
      {hasEvidenceCard && authSetupEvidence ? (
        <AuthSetupEvidenceCard
          evidence={authSetupEvidence}
          onOpenAgents={onOpenAgents ?? (() => {})}
        />
      ) : null}
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
      {hasReadinessCard && readinessCard ? (
        <ReadinessCard model={readinessCard} />
      ) : null}
    </div>
  );
}
