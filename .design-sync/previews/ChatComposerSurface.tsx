import {
  ArrowUp,
  Brain,
  ChatComposerControlRowFrame,
  ChatComposerSurface,
  ComposerActionButton,
  ComposerControlButton,
  ComposerTextarea,
  ComposerTextareaFrame,
  Plus,
  Zap,
} from "@proliferate/ui";

const LONG_DRAFT = [
  "Wave 2 of the design-sync import: every component in batch F is a product",
  "surface with no playground registry entry, so each preview is composed from",
  "the component source plus a real call site.",
  "",
  "Start with the account panes, then the billing cards, then the chat composer",
  "frames — the composer ones share a host so they can be graded side by side.",
  "",
  "After that, rebuild only the batch F components and re-capture. Do not run",
  "package-build or an unscoped capture: other agents are writing into the same",
  "bundle directory at the same time and an unscoped run would clobber their",
  "screenshots.",
  "",
  "Finally, read every contact sheet before writing a verdict.",
].join("\n");

export const Composer = () => (
  <ChatComposerSurface overflowMode="clip" className="w-full max-w-2xl pb-1">
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea
        rows={3}
        readOnly
        value="Rebuild the bundle, then capture only the batch F components."
      />
    </ComposerTextareaFrame>
    <ChatComposerControlRowFrame
      leading={
        <>
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
        </>
      }
      trailing={
        <ComposerControlButton
          iconOnly
          icon={<Plus className="icon-control" />}
          label="Attach file"
        />
      }
      action={
        <ComposerActionButton title="Send (⌘↵)" aria-label="Send">
          <ArrowUp className="icon-control" />
        </ComposerActionButton>
      }
    />
  </ChatComposerSurface>
);

export const EmptyPlaceholder = () => (
  <ChatComposerSurface overflowMode="clip" className="w-full max-w-2xl pb-1">
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea rows={2} placeholder="Ask anything, or describe the change you want…" />
    </ComposerTextareaFrame>
    <ChatComposerControlRowFrame
      leading={
        <ComposerControlButton
          emphasizeLabel
          icon={<Brain className="icon-control" />}
          label="Claude Opus 4.5"
        />
      }
      action={
        <ComposerActionButton title="Send (⌘↵)" aria-label="Send">
          <ArrowUp className="icon-control" />
        </ComposerActionButton>
      }
    />
  </ChatComposerSurface>
);

/**
 * `overflowMode="auto"` (the default) is what lets a long draft scroll inside
 * the composer instead of growing the dock — bounded here so the clipped edge
 * is the visible evidence.
 */
export const ScrollingDraft = () => (
  <ChatComposerSurface className="w-full max-w-2xl" style={{ maxHeight: 168 }}>
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea rows={16} readOnly value={LONG_DRAFT} />
    </ComposerTextareaFrame>
  </ChatComposerSurface>
);
