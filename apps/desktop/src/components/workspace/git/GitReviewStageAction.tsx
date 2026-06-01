import { Minus, Plus } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";

interface GitReviewStageActionProps {
  displayPath: string;
  path: string;
  shouldUnstage: boolean;
  disabled: boolean;
  stagePath: (path: string) => Promise<unknown>;
  unstagePath: (path: string) => Promise<unknown>;
}

export function GitReviewStageAction({
  displayPath,
  path,
  shouldUnstage,
  disabled,
  stagePath,
  unstagePath,
}: GitReviewStageActionProps) {
  return (
    <Tooltip content={shouldUnstage ? "Unstage file" : "Stage file"}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={(event) => {
          event.stopPropagation();
          if (shouldUnstage) {
            void unstagePath(path);
          } else {
            void stagePath(path);
          }
        }}
        disabled={disabled}
        aria-label={shouldUnstage ? `Unstage ${displayPath}` : `Stage ${displayPath}`}
        className={`size-6 rounded-full border-0 bg-transparent p-0 ${
          shouldUnstage
            ? "text-git-green hover:bg-sidebar-accent"
            : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        }`}
      >
        {shouldUnstage ? (
          <Minus className="size-3.5" />
        ) : (
          <Plus className="size-3.5" />
        )}
      </Button>
    </Tooltip>
  );
}
