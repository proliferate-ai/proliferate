import type { ReactNode } from "react";
import {
  ArrowUp,
  Blocks,
  Brain,
  ChatComposerControlRowFrame,
  ComposerActionButton,
  ComposerControlButton,
  ComposerTextarea,
  ComposerTextareaFrame,
  StopSquare,
  Target,
  Zap,
} from "@proliferate/ui";

/** The frame only owns the control grid — the composer supplies its chrome. */
const ComposerChrome = ({
  draft,
  placeholder,
  children,
}: {
  draft?: string;
  placeholder?: string;
  children: ReactNode;
}) => (
  <div className="w-full max-w-2xl rounded-composer bg-composer-background pb-1 shadow-popover ring-[0.5px] ring-border">
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea rows={2} readOnly value={draft ?? ""} placeholder={placeholder} />
    </ComposerTextareaFrame>
    {children}
  </div>
);

export const FullControlRow = () => (
  <ComposerChrome draft="Port the remaining product-surface components into .design-sync/previews.">
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
          <ComposerControlButton
            iconOnly
            icon={<Target className="icon-control" />}
            label="Set goal"
          />
        </>
      }
      trailing={
        <ComposerControlButton
          iconOnly
          icon={<Blocks className="icon-control" />}
          label="Integrations"
        />
      }
      action={
        <ComposerActionButton title="Send (⌘↵)" aria-label="Send">
          <ArrowUp className="icon-control" />
        </ComposerActionButton>
      }
    />
  </ComposerChrome>
);

export const ActionOnly = () => (
  <ComposerChrome draft="What changed in the last capture run?">
    <ChatComposerControlRowFrame
      action={
        <ComposerActionButton title="Send (⌘↵)" aria-label="Send">
          <ArrowUp className="icon-control" />
        </ComposerActionButton>
      }
    />
  </ComposerChrome>
);

export const SessionRunning = () => (
  <ComposerChrome placeholder="Send a follow-up while the agent works…">
    <ChatComposerControlRowFrame
      leading={
        <ComposerControlButton
          emphasizeLabel
          icon={<Brain className="icon-control" />}
          label="Claude Opus 4.5"
        />
      }
      action={
        <ComposerActionButton title="Stop (Esc)" aria-label="Stop">
          <StopSquare className="icon-control" />
        </ComposerActionButton>
      }
    />
  </ComposerChrome>
);
