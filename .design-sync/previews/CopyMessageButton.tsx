import { CopyMessageButton } from "@proliferate/ui";

// `visibilityClassName` is REQUIRED and is what the transcript uses to keep the
// button hover-only (`opacity-0 group-hover/turn:opacity-100`). Every cell here
// passes `opacity-100` — the revealed state — otherwise the button photographs
// as empty space.

const ANSWER = [
  "The transcript remounts because MarkdownBody rebuilds its components map on",
  "every render. Hoist the static overrides and memoize the per-call slots.",
].join(" ");

// The assistant footer row this button ships in: a tight action slot pulled up
// under the message prose.
const FOOTER = "flex items-center gap-2 text-chat";

export const Revealed = () => (
  <div className="w-full max-w-2xl">
    <p className="mb-2 text-message text-foreground">{ANSWER}</p>
    <div className={FOOTER}>
      <CopyMessageButton content={ANSWER} visibilityClassName="opacity-100" />
    </div>
  </div>
);

export const WithTimestampAfter = () => (
  <div className="w-full max-w-2xl">
    <p className="mb-2 text-message text-foreground">{ANSWER}</p>
    <div className={FOOTER}>
      <CopyMessageButton
        content={ANSWER}
        timestampLabel="2:14 PM"
        timestampPosition="after"
        visibilityClassName="opacity-100"
      />
    </div>
  </div>
);

export const WithTimestampBefore = () => (
  <div className="w-full max-w-2xl">
    <p className="mb-2 text-message text-foreground">{ANSWER}</p>
    <div className={FOOTER}>
      <CopyMessageButton
        content={ANSWER}
        timestampLabel="Yesterday 11:48 PM"
        timestampPosition="before"
        visibilityClassName="opacity-100"
      />
    </div>
  </div>
);

// The split the component was built for: the button stays visible on the final
// completed message while its date stays hover-only.
export const SplitVisibility = () => (
  <div className="w-full max-w-2xl">
    <p className="mb-2 text-message text-foreground">{ANSWER}</p>
    <div className={FOOTER}>
      <CopyMessageButton
        content={ANSWER}
        timestampLabel="2:14 PM"
        timestampPosition="after"
        visibilityClassName="opacity-100"
        timestampVisibilityClassName="opacity-0"
      />
      <span aria-hidden className="h-3 w-px bg-border" />
      <span className="text-chat-meta text-foreground-tertiary">
        date hidden until hover
      </span>
    </div>
  </div>
);
