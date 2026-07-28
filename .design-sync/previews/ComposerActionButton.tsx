import {
  ArrowUp,
  Brain,
  ComposerActionButton,
  ComposerControlButton,
  ComposerTextarea,
  ComposerTextareaFrame,
  Plus,
  StopSquare,
  Zap,
} from "@proliferate/ui";

export const Send = () => (
  <div className="flex items-center gap-3">
    <ComposerActionButton
      title="Send (⌘↵)"
      aria-label="Send"
      onClick={() => {}}
    >
      <ArrowUp className="icon-control" />
    </ComposerActionButton>
    <span className="text-ui-sm text-muted-foreground">Send (⌘↵)</span>
  </div>
);

export const StopAndDisabled = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-3">
      <ComposerActionButton
        title="Stop"
        aria-label="Stop"
        onClick={() => {}}
      >
        <StopSquare className="icon-control" />
      </ComposerActionButton>
      <span className="text-ui-sm text-muted-foreground">
        running — click to interrupt
      </span>
    </div>
    <div className="flex items-center gap-3">
      <ComposerActionButton disabled title="Type a message first" aria-label="Send">
        <ArrowUp className="icon-control" />
      </ComposerActionButton>
      <span className="text-ui-sm text-muted-foreground">
        disabled — nothing to send
      </span>
    </div>
  </div>
);

export const InComposerFooter = () => (
  <div className="w-full max-w-2xl rounded-xl border border-border bg-composer-background pb-2">
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea
        rows={2}
        defaultValue="Port the playground registry compositions into the design-sync previews."
        readOnly
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
        label="Build"
        detail="auto-approve edits"
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
