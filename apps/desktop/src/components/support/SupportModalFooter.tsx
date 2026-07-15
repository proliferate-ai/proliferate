import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import type { SupportOutreachEmailState } from "@/hooks/support/facade/use-support-outreach-email";

interface SupportModalFooterProps {
  outreach: SupportOutreachEmailState;
}

/**
 * Muted "Updates go to {email} · change" line shown above the action buttons in
 * both support modals. "change" swaps to an inline editor that persists the
 * account-wide `outreach_email` override.
 */
export function SupportModalFooter({ outreach }: SupportModalFooterProps) {
  if (outreach.isEditing) {
    return (
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-2">
          <Input
            type="email"
            autoFocus
            value={outreach.draft}
            onChange={(event) => outreach.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void outreach.save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                outreach.cancelEdit();
              }
            }}
            placeholder="you@example.com"
            aria-label="Email for support updates"
            aria-invalid={outreach.error ? true : undefined}
            className="flex-1"
          />
          <Button
            type="button"
            size="sm"
            loading={outreach.isSaving}
            onClick={() => { void outreach.save(); }}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={outreach.isSaving}
            onClick={outreach.cancelEdit}
          >
            Cancel
          </Button>
        </div>
        {outreach.error ? (
          <p className="text-ui-sm text-destructive">{outreach.error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="text-ui-sm text-muted-foreground">
      Updates go to {outreach.effectiveEmail ?? "your account email"}
      {" · "}
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        className="underline underline-offset-2 hover:text-foreground"
        onClick={outreach.beginEdit}
      >
        change
      </Button>
    </p>
  );
}
