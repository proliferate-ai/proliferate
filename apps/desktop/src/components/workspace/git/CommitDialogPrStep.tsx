import { useCallback } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { ArrowLeft, Sparkles } from "@proliferate/ui/icons";
import type { CommitDialogState } from "@/hooks/workspaces/workflows/use-commit-dialog";

interface CommitDialogPrStepProps {
  state: CommitDialogState;
  onSubmit: () => Promise<void>;
  onBack: () => void;
  isSubmitting: boolean;
}

export function CommitDialogPrStep({
  state,
  onSubmit,
  onBack,
  isSubmitting,
}: CommitDialogPrStepProps) {
  const { prDraft, error, derived, generation } = state;
  const isGenerating = generation.prStatus === "generating";

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void onSubmit();
    }
  }, [onSubmit]);

  const handleGenerate = useCallback(() => {
    if (!generation.generatePrFields) return;
    void generation.generatePrFields().then((result) => {
      if (result) {
        state.setPrDraft({ ...state.prDraft, title: result.title, body: result.body });
      }
    });
  }, [generation, state]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="flex flex-col" onKeyDown={handleKeyDown}>
      {/* Header — back affordance + generate button */}
      <div className="flex h-9 items-center gap-2 px-3">
        <IconButton
          size="xs"
          onClick={onBack}
          disabled={isSubmitting}
          aria-label="Back"
          className="rounded"
        >
          <ArrowLeft className="size-3" />
        </IconButton>
        <span className="flex-1 text-sm font-medium text-foreground">Create pull request</span>
        {generation.generationAvailable && (
          <Button
            variant="ghost"
            size="unstyled"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
            onClick={handleGenerate}
            disabled={isSubmitting || isGenerating}
            aria-label="Generate PR details"
          >
            <Sparkles className="size-3" />
            {isGenerating ? "Generating…" : "Generate"}
          </Button>
        )}
      </div>

      {/* Form fields */}
      <div className="space-y-3 px-3 pb-3">
        <div>
          <Label htmlFor="pr-title" className="sr-only">Title</Label>
          <Input
            id="pr-title"
            value={prDraft.title}
            onChange={(event) => state.setPrDraft({ ...prDraft, title: event.target.value })}
            placeholder={generation.generationAvailable
              ? "PR title (leave blank to generate)"
              : "PR title"}
            disabled={isSubmitting}
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="pr-body" className="sr-only">Description</Label>
          <Textarea
            id="pr-body"
            rows={3}
            value={prDraft.body}
            onChange={(event) => state.setPrDraft({ ...prDraft, body: event.target.value })}
            placeholder="Description (optional)"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Label htmlFor="pr-base-branch" className="sr-only">Base branch</Label>
            <Input
              id="pr-base-branch"
              value={prDraft.baseBranch}
              onChange={(event) => state.setPrDraft({ ...prDraft, baseBranch: event.target.value })}
              placeholder={derived.defaultBaseBranch}
              disabled={isSubmitting}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="pr-draft-toggle"
              checked={prDraft.draft}
              onChange={(draft) => state.setPrDraft({ ...prDraft, draft })}
              disabled={isSubmitting}
            />
            <Label htmlFor="pr-draft-toggle" className="mb-0 text-sm">Draft</Label>
          </div>
        </div>
      </div>

      {/* Error strip */}
      {error && (
        <div className="px-3 pb-2">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Footer — create button */}
      <div className="flex items-center justify-end border-t border-border/60 px-3 py-2">
        <Button
          type="button"
          variant="inverted"
          size="sm"
          loading={isSubmitting}
          disabled={isSubmitting}
          onClick={() => void onSubmit()}
        >
          Create pull request
        </Button>
      </div>
    </div>
  );
}
