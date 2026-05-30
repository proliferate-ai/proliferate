import { AlertCircle, ArrowUp, CheckCircle2, LifeBuoy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

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
      <form onSubmit={handleSubmit}>
        <section className="overflow-hidden rounded-lg border border-border-light bg-surface-elevated shadow-subtle">
          <div className="border-b border-border-light px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <LifeBuoy size={15} />
              Contact support
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-4 text-muted-foreground">
              Share what happened, what you expected, and the workspace, automation, or billing flow involved.
            </p>
          </div>

          <div className="space-y-3 p-3">
            <div className="rounded-lg border border-input bg-surface-control p-3 focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                rows={8}
                value={message}
                onChange={(event) => {
                  setMessage(event.currentTarget.value);
                  if (notice) {
                    setNotice(null);
                  }
                }}
                variant="ghost"
                className="min-h-[12rem] w-full resize-none text-sm leading-5"
                placeholder="What happened?"
                data-telemetry-mask
              />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-light pt-3">
                <p className="min-w-0 text-xs leading-4 text-muted-foreground">
                  Includes current app location. Do not include secrets or API keys.
                </p>
                <Button
                  type="submit"
                  size="icon"
                  loading={submitting}
                  disabled={!trimmedMessage || submitting}
                  aria-label="Send support message"
                >
                  <ArrowUp size={16} />
                </Button>
              </div>
            </div>

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
          </div>
        </section>
      </form>

      <section className="grid gap-3 sm:grid-cols-2">
        <InfoCard
          title="Product help"
          description="Cloud sessions, Desktop handoff, billing, automations, workspace dispatch, and account issues."
        />
        <InfoCard
          title="Account context"
          description="Support messages include the current app location so we can find the right account state."
        />
      </section>
    </div>
  );
}

function InfoCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-elevated px-4 py-3 shadow-subtle">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mt-1 text-xs leading-4 text-muted-foreground">{description}</p>
    </div>
  );
}
