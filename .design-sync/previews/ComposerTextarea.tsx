import { useState } from "react";
import {
  ArrowUp,
  Brain,
  ComposerActionButton,
  ComposerControlButton,
  ComposerTextarea,
  ComposerTextareaFrame,
  Plus,
  Zap,
} from "@proliferate/ui";

export const Placeholder = () => (
  <div className="w-96 rounded-xl border border-border bg-composer-background pb-2">
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea
        rows={3}
        placeholder="Ask anything, or describe the change you want…"
      />
    </ComposerTextareaFrame>
  </div>
);

export const WithMessage = () => (
  <div className="w-96 rounded-xl border border-border bg-composer-background pb-2">
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea
        rows={4}
        readOnly
        defaultValue={
          "Port every playground registry composition into .design-sync/previews, " +
          "then rebuild and capture the sheets for the primitives tier."
        }
      />
    </ComposerTextareaFrame>
  </div>
);

export const FullComposer = () => {
  const [value, setValue] = useState(
    "Why does the Tailwind safelist need the DS colour roles spelled out?",
  );
  return (
    <div className="w-96 rounded-xl border border-border bg-composer-background pb-2">
      <ComposerTextareaFrame topInset="standard">
        <ComposerTextarea
          rows={3}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </ComposerTextareaFrame>
      <div className="flex items-center gap-1 px-2">
        <ComposerControlButton
          emphasizeLabel
          icon={<Brain className="icon-control" />}
          label="Claude Opus 4.5"
        />
        <ComposerControlButton
          icon={<Zap className="icon-control" />}
          label="Plan"
          detail="read-only"
        />
        <ComposerControlButton
          iconOnly
          icon={<Plus className="icon-control" />}
          label="Attach file"
        />
        <div className="ml-auto">
          <ComposerActionButton title="Send (⌘↵)" aria-label="Send">
            <ArrowUp className="icon-control" />
          </ComposerActionButton>
        </div>
      </div>
    </div>
  );
};
