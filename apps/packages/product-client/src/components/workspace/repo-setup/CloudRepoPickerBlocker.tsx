import { Check } from "#product/primitives/icons/core";
import { RotateCw, ShieldAlert } from "#product/primitives/icons/status";
import { GitHub } from "#product/primitives/icons/platform";
import { Button } from "#product/primitives/Button";
import type {
  CloudRepoPickerBlockerView,
  CloudRepoPickerWaitingView,
} from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";

/** Staged prerequisite state with one primary action for the current step. */
export function CloudRepoPickerBlocker({
  blocker,
}: {
  blocker: CloudRepoPickerBlockerView;
}) {
  // Parked on GitHub: the checklist and its CTA would only restate the tab the
  // user is already looking at, so the waiting panel replaces both.
  if (blocker.waiting) {
    return <WaitingForGitHub waiting={blocker.waiting} />;
  }

  return (
    <div>
      <div className="flex items-start gap-3 py-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-control text-muted-foreground">
          <ShieldAlert aria-hidden className="icon-paired" />
        </span>
        <span className="min-w-0 flex-1">
          <h3 className="text-ui font-medium leading-5 text-foreground">{blocker.title}</h3>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">
            {blocker.description}
          </p>
        </span>
      </div>
      {blocker.steps?.length ? (
        <ol className="mt-4 space-y-3" aria-label="GitHub setup progress">
          {blocker.steps.map((step, index) => (
            <li
              key={step.label}
              className="flex items-start gap-3"
              aria-current={step.status === "current" ? "step" : undefined}
            >
              <span
                className={[
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-ui-sm font-medium",
                  step.status === "complete"
                    ? "bg-success-subtle text-success"
                    : step.status === "current"
                      ? "bg-foreground text-background"
                      : "bg-surface-control text-muted-foreground",
                ].join(" ")}
                aria-hidden
              >
                {step.status === "complete" ? <Check className="icon-paired" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-ui font-medium text-foreground">{step.label}</span>
                <span className="mt-0.5 block text-ui-sm text-muted-foreground">
                  {step.description}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {blocker.actionLabel && blocker.onAction ? (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={blocker.actionLoading}
            onClick={blocker.onAction}
          >
            {blocker.actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "You're on GitHub now" — the state the flow sits in between opening GitHub
 * and the user coming back. Re-checking is a button, never a poll: the trip can
 * take minutes and a silent retry loop leaves nothing to press when the answer
 * is still no.
 */
function WaitingForGitHub({ waiting }: { waiting: CloudRepoPickerWaitingView }) {
  return (
    <div>
      <div className="flex items-start gap-3 px-2 py-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-control text-muted-foreground">
          <GitHub aria-hidden className="icon-paired" />
        </span>
        <span className="min-w-0 flex-1">
          <h3 className="text-ui-sm font-medium leading-5 text-foreground">{waiting.title}</h3>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">{waiting.description}</p>
        </span>
      </div>
      {waiting.requestText ? (
        <div className="mx-2 mt-1 rounded-lg border border-border bg-surface-elevated-secondary p-2.5">
          <p className="text-ui-sm text-muted-foreground">{waiting.requestText}</p>
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 px-2 pb-1.5 pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={waiting.onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={waiting.checking}
          onClick={waiting.onCheckAgain}
        >
          <RotateCw aria-hidden className="icon-control" />
          {waiting.checkAgainLabel}
        </Button>
      </div>
    </div>
  );
}
