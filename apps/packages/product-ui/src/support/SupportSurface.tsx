import { AlertCircle, CheckCircle2, CircleHelp, LifeBuoy, MessageSquare, Send } from "lucide-react";
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
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="space-y-3">
        <article className="border-b border-border-light pb-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare size={16} />
            Product help
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Cloud sessions, Desktop handoff, billing, and workspace dispatch issues.
          </p>
        </article>
        <article className="border-b border-border-light pb-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CircleHelp size={16} />
            Product docs
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Setup, cloud sandbox, automation, and environment guidance.
          </p>
        </article>
        <article className="pb-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LifeBuoy size={16} />
            Account context
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Messages include the current app location so the team can find the right account state.
          </p>
        </article>
      </section>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LifeBuoy size={16} />
          Contact
        </div>
        <Textarea
          rows={10}
          value={message}
          onChange={(event) => {
            setMessage(event.currentTarget.value);
            if (notice) {
              setNotice(null);
            }
          }}
          className="w-full resize-none"
          placeholder="What happened?"
          data-telemetry-mask
        />
        {notice ? (
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
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
          <Button type="submit" loading={submitting} disabled={!trimmedMessage || submitting}>
            <Send size={15} />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
