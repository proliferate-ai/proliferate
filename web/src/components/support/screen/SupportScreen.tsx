import { CircleHelp, Mail, MessageSquare, Send } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

export function SupportScreen() {
  return (
    <div className="web-scrollbar h-full overflow-y-auto px-8 py-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase text-muted-foreground">Support</p>
        <h1 className="mt-2 text-2xl font-semibold">Get help</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="space-y-3">
          <article className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare size={16} />
              Product support
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Send a message to the team with your current workspace context attached.
            </p>
          </article>
          <article className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CircleHelp size={16} />
              Docs
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
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
              className="w-full resize-none rounded-md border border-input bg-surface-control p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              placeholder="What happened?"
            />
            <div className="flex justify-end">
              <Button>
                <Send size={15} />
                Send
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
