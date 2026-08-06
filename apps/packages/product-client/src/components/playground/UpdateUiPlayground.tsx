import { type ReactNode } from "react";
import { Badge } from "#product/primitives/Badge";
import { UPDATE_PREVIEW_STATES } from "#product/config/update-playground";
import { ReleaseNoticeCard } from "#product/components/workspace/shell/sidebar/ReleaseNoticeCard";
import { UpdateUiPlaygroundControls } from "#product/components/playground/UpdateUiPlaygroundControls";

// The standalone `?update=1` window preview is gone with the window itself: an
// update is an event in the app, not a second app, and its one standing
// setting ("Keep Proliferate up to date") moved to Settings → General.
export function UpdateUiPlayground() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-7 py-5">
        <div className="mx-auto flex max-w-6xl items-end justify-between gap-6">
          <div className="space-y-1">
            <p className="text-ui-sm font-medium uppercase text-muted-foreground">
              Dev preview
            </p>
            <h1 className="text-title font-medium tracking-tight">
              Desktop Update UI
            </h1>
            <p className="max-w-2xl text-body text-muted-foreground">
              Forced render of updater states without touching the real updater workflow.
            </p>
          </div>
          <Badge>import.meta.env.DEV</Badge>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-7 py-7">
        <PreviewSection
          title="Release notice card (sidebar footer)"
          description="The installed-release changelog card shown after an update. This is the production component at its sidebar-width constraint."
        >
          <div className="rounded-lg border border-border bg-card/60 p-5">
            <div className="w-64 rounded-lg bg-sidebar py-2">
              <ReleaseNoticeCard
                notice={{ version: "0.1.42", title: "Introducing Grok" }}
                onDismiss={() => {}}
                onOpenChangelog={() => {}}
              />
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Production Surfaces"
          description="Live updater components driven by the dev updater mock. The toast keeps the authored release title while its Download, progress, and Restart states morph in place; the restart dialog renders as the real app modal; the footer control below is fed by the same mock. Use “+ standard toast” to confirm the toast treatment matches the rest of the app."
        >
          <UpdateUiPlaygroundControls />
        </PreviewSection>

        <PreviewSection
          title="Copy deck"
          description="Reference copy for each updater phase. The production surfaces (toast, footer control, restart dialog, settings row) draw from these strings."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {UPDATE_PREVIEW_STATES.map((state) => (
              <article
                key={state.id}
                className="rounded-lg border border-border bg-card/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-heading font-medium">{state.title}</h3>
                  <Badge>{state.phase}</Badge>
                </div>
                <p className="mt-1 text-body text-muted-foreground">{state.description}</p>
                <p className="mt-0.5 text-ui-sm text-muted-foreground/80">{state.detail}</p>
                <p className="mt-3 text-ui-sm text-muted-foreground">
                  {state.primaryAction}
                  {state.secondaryAction ? ` · ${state.secondaryAction}` : ""}
                </p>
              </article>
            ))}
          </div>
        </PreviewSection>
      </main>
    </div>
  );
}

function PreviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="space-y-1">
        <h2 className="text-heading font-medium">{title}</h2>
        <p className="max-w-3xl text-body text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
