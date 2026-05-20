import { CircleHelp, Mail, MessageSquare, Send } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

interface SupportSurfaceProps {
  onSubmit?: () => void;
}

export function SupportSurface({ onSubmit }: SupportSurfaceProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="space-y-3">
        <article className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare size={16} />
            Product support
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Send a message to the team with your current workspace context attached.
          </p>
        </article>
        <article className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CircleHelp size={16} />
            Docs
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Setup, cloud sandbox, and automation guides stay grouped with product support.
          </p>
        </article>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Mail size={16} />
          Contact
        </div>
        <div className="grid gap-3">
          <Input placeholder="Email" />
          <Input placeholder="Subject" />
          <Textarea
            rows={8}
            className="w-full resize-none"
            placeholder="What happened?"
          />
          <div className="flex justify-end">
            <Button onClick={onSubmit}>
              <Send size={15} />
              Send
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
