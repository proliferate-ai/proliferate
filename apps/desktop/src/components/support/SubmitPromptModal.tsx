import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { useSupportModalState } from "@/hooks/support/facade/use-support-modal-state";

interface SubmitPromptModalProps {
  onClose: () => void;
}

export function SubmitPromptModal({ onClose }: SubmitPromptModalProps) {
  const {
    canSend,
    creditConsent,
    creditName,
    handleCancel,
    handleSend,
    isSubmitting,
    message,
    setCreditConsent,
    setCreditName,
    setMessage,
    stagingError,
  } = useSupportModalState({ kind: "feature", onClose });

  return (
    <ModalShell
      open
      onClose={handleCancel}
      title="Submit a prompt"
      description="Prompt a coding agent to build what you want to see in Proliferate."
      sizeClassName="max-w-lg"
      bodyClassName="px-5 pb-5 pt-0"
      telemetryBlocked
    >
      <div className="space-y-4">
        <section className="space-y-2">
          <Textarea
            id="support-prompt-message"
            variant="code"
            autoFocus
            data-telemetry-mask
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Prompt a coding agent to build what you want to see in Proliferate. If we like it, we'll run it and merge the result."
            className="min-h-[140px]"
          />
        </section>

        <div className="space-y-2">
          <Label className="mb-0 flex cursor-pointer items-center gap-3 rounded-lg border border-border/70 bg-surface-control/60 px-3 py-2.5 text-ui text-foreground">
            <Checkbox
              checked={creditConsent}
              onCheckedChange={(checked) => setCreditConsent(checked === true)}
            />
            <span className="font-medium text-ui">Credit me if this merges</span>
          </Label>

          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: creditConsent ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden p-px">
              <Input
                value={creditName}
                onChange={(event) => setCreditName(event.target.value)}
                placeholder="Your name or @handle"
                aria-label="Name to credit"
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {stagingError ? (
          <p className="text-ui-sm text-destructive">{stagingError}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSend}
            loading={isSubmitting}
            onClick={() => { void handleSend(); }}
          >
            Send
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
