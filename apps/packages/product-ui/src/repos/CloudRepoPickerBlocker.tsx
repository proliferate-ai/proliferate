import { Check, ShieldAlert } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import type { CloudRepoPickerBlockerView } from "./CloudRepoPicker";

/** Staged prerequisite state with one primary action for the current step. */
export function CloudRepoPickerBlocker({
  blocker,
}: {
  blocker: CloudRepoPickerBlockerView;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 py-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-control text-muted-foreground">
          <ShieldAlert size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <h3 className="text-ui font-medium leading-5 text-foreground">{blocker.title}</h3>
          <p className="mt-0.5 text-ui-sm leading-[1.45] text-muted-foreground">
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
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
                  step.status === "complete"
                    ? "bg-success-subtle text-success"
                    : step.status === "current"
                      ? "bg-foreground text-background"
                      : "bg-surface-control text-muted-foreground",
                ].join(" ")}
                aria-hidden
              >
                {step.status === "complete" ? <Check size={12} /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-ui font-medium text-foreground">{step.label}</span>
                <span className="mt-0.5 block text-ui-sm leading-[1.45] text-muted-foreground">
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
