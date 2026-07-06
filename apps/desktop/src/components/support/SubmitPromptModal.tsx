import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { useSupportModalState } from "@/hooks/support/facade/use-support-modal-state";
import { useSupportOutreachEmail } from "@/hooks/support/facade/use-support-outreach-email";
import { SupportCheckboxRow } from "./SupportCheckboxRow";
import { SupportCreditField } from "./SupportCreditField";
import { SupportModalFooter } from "./SupportModalFooter";

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
    notifyMe,
    setCreditConsent,
    setCreditName,
    setMessage,
    setNotifyMe,
    stagingError,
  } = useSupportModalState({ kind: "feature", onClose });
  const outreach = useSupportOutreachEmail();

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

        <div className="space-y-0.5">
          <SupportCreditField
            label="Credit me if this merges"
            creditConsent={creditConsent}
            setCreditConsent={setCreditConsent}
            creditName={creditName}
            setCreditName={setCreditName}
          />
          <SupportCheckboxRow
            checked={notifyMe}
            onCheckedChange={setNotifyMe}
            label="Let me know when you merge this"
          />
        </div>

        {stagingError ? (
          <p className="text-ui-sm text-destructive">{stagingError}</p>
        ) : null}

        <SupportModalFooter outreach={outreach} />

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
