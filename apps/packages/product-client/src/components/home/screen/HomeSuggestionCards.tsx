import { HOME_SUGGESTION_PROMPTS } from "#product/copy/home/home-screen-copy";
import { ActionCard } from "#product/primitives/patterns/ActionCard";
import { BuildModeFilled } from "#product/primitives/icons/product";
import { CircleCheck } from "#product/primitives/icons/status";
import { FileDiff, ReadBook } from "#product/primitives/icons/workspace";

function suggestionIcon(index: number) {
  switch (index) {
    case 0:
      return <ReadBook className="icon-paired" />;
    case 1:
      return <BuildModeFilled className="icon-paired" />;
    case 2:
      return <FileDiff className="icon-paired" />;
    default:
      return <CircleCheck className="icon-paired" />;
  }
}

export function HomeSuggestionCards({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div
      className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4"
      data-home-suggestion-grid
    >
      {HOME_SUGGESTION_PROMPTS.map((prompt, index) => (
        <ActionCard
          key={prompt}
          leading={suggestionIcon(index)}
          title={prompt}
          actionLabel={prompt}
          onAction={() => onSelect(prompt)}
        />
      ))}
    </div>
  );
}
