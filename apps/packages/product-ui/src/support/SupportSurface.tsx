import { AlertCircle, CheckCircle2, LifeBuoy, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsCardRow } from "../settings/SettingsCardRow";

interface SupportSurfaceProps {
  onSubmit?: (message: string) => Promise<void> | void;
}

export function SupportSurface({ onSubmit }: SupportSurfaceProps) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const trimmedMessage = message.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedMessage || submitting) {
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      await onSubmit?.(trimmedMessage);
      setMessage("");
      setNotice({ tone: "success", text: "Support message sent." });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Support message could not be sent.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard>
        <SettingsCardRow
          label="Product help"
          description="Cloud sessions, Desktop handoff, billing, automations, workspace dispatch, and account issues."
        />
        <SettingsCardRow
          label="Account context"
          description="Support messages include the current app location so we can find the right account state."
        />
      </SettingsCard>
      <form onSubmit={handleSubmit}>
        <SettingsCard>
          <SettingsCardRow
            label={
              <span className="flex items-center gap-2">
                <LifeBuoy size={15} />
                Contact support
              </span>
            }
            description="Share what happened, what you expected, and the workspace or automation involved."
          />
          <div className="space-y-3 px-4 py-3">
            <Textarea
              rows={8}
              value={message}
              onChange={(event) => {
                setMessage(event.currentTarget.value);
                if (notice) {
                  setNotice(null);
                }
              }}
              className="min-h-[9rem] w-full resize-none"
              placeholder="What happened?"
              data-telemetry-mask
            />
            {notice ? (
              <div
                role="status"
                aria-live="polite"
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  notice.tone === "success"
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {notice.tone === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <span>{notice.text}</span>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                loading={submitting}
                disabled={!trimmedMessage || submitting}
              >
                <Send size={15} />
                Send
              </Button>
            </div>
          </div>
        </SettingsCard>
      </form>
    </div>
  );
}
