import { Button } from "@proliferate/ui/primitives/Button";
import { GitHub, Settings, SlidersHorizontal } from "@proliferate/ui/icons";
import type {
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

export function HomeOnboardingCards({
  cards,
  isAddingRepo,
  onSelect,
}: {
  cards: HomeOnboardingCardModel[];
  isAddingRepo: boolean;
  onSelect: (card: HomeOnboardingCardModel) => void;
}) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {cards.map((card) => (
        <Button
          key={card.id}
          type="button"
          variant="unstyled"
          size="unstyled"
          loading={card.id === "add-repository" && isAddingRepo}
          aria-label={card.title}
          onClick={() => onSelect(card)}
          className="group flex h-24 w-full min-w-0 flex-col items-start whitespace-normal rounded-2xl border border-border/60 bg-card/70 p-3 text-left transition-colors hover:border-border hover:bg-foreground/5 hover:text-foreground"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground transition-colors group-hover:bg-foreground/10 group-hover:text-foreground">
            {resolveOnboardingIcon(card.icon)}
          </span>
          <span className="mt-auto max-w-44 break-words text-base font-medium leading-5 text-foreground">
            {card.title}
          </span>
        </Button>
      ))}
    </div>
  );
}
