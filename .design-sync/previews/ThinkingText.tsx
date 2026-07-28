import { Spinner, ThinkingText, UserAvatar } from "@proliferate/ui";

export const Default = () => <ThinkingText />;

export const Labels = () => (
  <div className="flex flex-col items-start gap-3">
    <ThinkingText />
    <ThinkingText text="Planning the migration" />
    <ThinkingText text="Reading server/agent/src/session.rs" />
    <ThinkingText text="Running pnpm -F @proliferate/product-ui build" />
  </div>
);

export const InChatTurn = () => (
  <div className="flex w-[30rem] items-start gap-3">
    <UserAvatar displayName="Proliferate Agent" className="size-8" />
    <div className="flex min-w-0 flex-col gap-1">
      <ThinkingText text="Thinking about the sidebar retune" />
      <span className="text-chat-meta text-muted-foreground">
        Claude Opus 4.6 · 12s · 3 tools used
      </span>
    </div>
  </div>
);

export const WithSpinner = () => (
  <div className="flex w-[30rem] items-center gap-2 rounded-lg border border-border px-3 py-2">
    <Spinner className="icon-paired text-muted-foreground" />
    <ThinkingText text="Applying edits to 4 files" />
  </div>
);

export const InPhaseSync = () => (
  <div className="flex flex-col items-start gap-2">
    <ThinkingText text="Thinking" motionOriginMs={0} />
    <ThinkingText text="Thinking" motionOriginMs={0} />
    <ThinkingText text="Thinking" motionOriginMs={0} />
  </div>
);
