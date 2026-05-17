import { Apple, Github, KeyRound, ShieldCheck } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

export function SettingsScreen() {
  return (
    <div className="web-scrollbar h-full overflow-y-auto px-8 py-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase text-muted-foreground">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold">Account and identity</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={16} />
            Product identity
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            GitHub stays connected to the product account before cloud workspaces are available.
          </p>
          <div className="mt-4 grid gap-2">
            <div className="flex items-center justify-between rounded-md border border-border bg-background p-3">
              <span className="inline-flex items-center gap-2 text-sm">
                <Github size={15} />
                GitHub
              </span>
              <span className="text-xs text-success">Connected</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-background p-3">
              <span className="inline-flex items-center gap-2 text-sm">
                <Apple size={15} />
                Apple
              </span>
              <Button variant="secondary" size="sm">Connect</Button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound size={16} />
            Cloud credentials
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Credential sync controls which agents and shared sandboxes can use configured auth.
          </p>
          <div className="mt-4 rounded-md border border-border bg-background p-3 text-sm">
            Shared cloud sandbox: <span className="text-success">Configured</span>
          </div>
        </section>
      </div>
    </div>
  );
}
