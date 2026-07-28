import { AssistantMessage, ClaimBanner } from "@proliferate/ui";

const noop = () => {};

export const Unclaimed = () => (
  <div className="w-full max-w-2xl">
    <ClaimBanner
      view={{
        kind: "unclaimed",
        title: "This session has no owner",
        description:
          "Claim it to send prompts and take over the running agent on proliferate-ai/proliferate.",
        actionLabel: "Claim session",
        onClaim: noop,
      }}
    />
  </div>
);

export const ClaimedByOther = () => (
  <div className="w-full max-w-2xl">
    <ClaimBanner
      view={{
        kind: "claimed_by_other",
        claimantName: "Pablo Hansen",
        description:
          "You can follow along in read-only mode. Ask Pablo to release the session to send prompts.",
      }}
    />
  </div>
);

/** Where the banner actually lands: at the head of the chat thread column. */
export const AboveTranscript = () => (
  <div className="flex w-full max-w-2xl flex-col gap-4">
    <ClaimBanner
      view={{
        kind: "unclaimed",
        title: "This session has no owner",
        description: "Claim it to send prompts and take over the running agent.",
        actionLabel: "Claim session",
        onClaim: noop,
      }}
    />
    <AssistantMessage content="Rebased `claude/design-sync-ui-import` onto `main` and re-ran the bundle build. No conflicts in the preview directory." />
  </div>
);
