import {
  ChatComposerControlRowFrame,
  ChatComposerSurface,
  ComposerActionButton,
  ComposerControlButton,
  ComposerTextarea,
  ComposerTextareaFrame,
  Badge,
  Brain,
  GitBranch,
  SendIcon,
  Sparkles,
} from "@proliferate/ui";

const DRAFT = "Port the playground library compositions into .design-sync/previews and rebuild the sheet for the patterns tier.";

const controlRow = (
  <ChatComposerControlRowFrame
    leading={(
      <>
        <ComposerControlButton
          label="Claude Opus 5"
          icon={<Sparkles className="icon-paired" />}
        />
        <ComposerControlButton
          label="high"
          icon={<Brain className="icon-paired" />}
        />
      </>
    )}
    action={(
      <ComposerActionButton aria-label="Send message">
        <SendIcon className="icon-paired" />
      </ComposerActionButton>
    )}
  />
);

export const TopInsetStandard = () => (
  <div className="w-full max-w-2xl">
    <ChatComposerSurface overflowMode="visible">
      <ComposerTextareaFrame topInset="standard">
        <ComposerTextarea
          data-chat-composer-editor
          rows={3}
          value={DRAFT}
          spellCheck={false}
          readOnly
        />
      </ComposerTextareaFrame>
      {controlRow}
    </ChatComposerSurface>
    <p className="mt-2 text-ui-sm text-muted-foreground">
      topInset=&quot;standard&quot; — 12px of breathing room above the first line.
    </p>
  </div>
);

export const TopInsetNone = () => (
  <div className="w-full max-w-2xl">
    <ChatComposerSurface overflowMode="visible">
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <Badge tone="neutral" className="gap-1">
          <GitBranch className="icon-paired" />
          claude/design-sync-ui-import
        </Badge>
        <Badge tone="neutral">preview-rebuild.mjs</Badge>
      </div>
      <ComposerTextareaFrame topInset="none">
        <ComposerTextarea
          data-chat-composer-editor
          rows={2}
          value="Use these attachments to tighten the capture harness."
          spellCheck={false}
          readOnly
        />
      </ComposerTextareaFrame>
      {controlRow}
    </ChatComposerSurface>
    <p className="mt-2 text-ui-sm text-muted-foreground">
      topInset=&quot;none&quot; — attachment chips already supply the top gap.
    </p>
  </div>
);

export const EmptyPlaceholder = () => (
  <div className="w-full max-w-2xl">
    <ChatComposerSurface overflowMode="visible">
      <ComposerTextareaFrame topInset="standard">
        <ComposerTextarea
          data-chat-composer-editor
          rows={2}
          defaultValue=""
          placeholder="Ask Proliferate to change something in proliferate/proliferate…"
          spellCheck={false}
        />
      </ComposerTextareaFrame>
      {controlRow}
    </ChatComposerSurface>
  </div>
);

export const InsetComparison = () => (
  <div className="flex w-full max-w-2xl flex-col gap-4">
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm text-muted-foreground">standard</span>
      <ChatComposerSurface overflowMode="visible">
        <ComposerTextareaFrame topInset="standard">
          <ComposerTextarea rows={1} value="Rebase onto main and re-run the sheet." readOnly />
        </ComposerTextareaFrame>
        {controlRow}
      </ChatComposerSurface>
    </div>
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm text-muted-foreground">none</span>
      <ChatComposerSurface overflowMode="visible">
        <ComposerTextareaFrame topInset="none">
          <ComposerTextarea rows={1} value="Rebase onto main and re-run the sheet." readOnly />
        </ComposerTextareaFrame>
        {controlRow}
      </ChatComposerSurface>
    </div>
  </div>
);
