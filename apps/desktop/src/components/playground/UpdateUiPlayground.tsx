import { useState, type ReactNode } from "react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { UPDATE_PREVIEW_STATES } from "@/config/update-playground";
import { UpdateDialogContent } from "@/components/feedback/UpdateDialogContent";
import { SidebarUpdatePill } from "@/components/workspace/shell/sidebar/SidebarUpdatePill";
import { UpdateUiPlaygroundControls } from "@/components/playground/UpdateUiPlaygroundControls";

const PREVIEW_VERSION = "0.1.42";

export function UpdateUiPlayground() {
  const [sparkleAutoUpdate, setSparkleAutoUpdate] = useState(true);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-7 py-5">
        <div className="mx-auto flex max-w-6xl items-end justify-between gap-6">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Dev preview
            </p>
            <h1 className="text-xl font-medium tracking-tight">
              Desktop Update UI
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Forced render of updater states without touching the real updater workflow.
            </p>
          </div>
          <Badge>import.meta.env.DEV</Badge>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-7 py-7">
        <PreviewSection
          title="Standalone Update Window"
          description="What the ?update=1 OS window would look like: its own window (mac chrome), mono-dark, version compare, auto-update opt-in, Install Update on our primary accent (not Sparkle blue). This is the exact UpdateDialogContent the real window will host."
        >
          <div className="flex justify-center rounded-xl border border-border/50 bg-background/40 px-6 py-12">
            <div className="w-[540px] overflow-hidden rounded-[12px] border border-border/70 bg-card shadow-floating-dark">
              <div className="flex items-center gap-2 px-4 pt-4">
                <span className="size-3 rounded-full bg-[#ff5f57]" />
                <span className="size-3 rounded-full bg-[#febc2e]" />
                <span className="size-3 rounded-full bg-foreground/20" />
              </div>
              <UpdateDialogContent
                availableVersion={PREVIEW_VERSION}
                currentVersion="0.1.41"
                autoUpdate={sparkleAutoUpdate}
                onToggleAutoUpdate={setSparkleAutoUpdate}
                onSkip={() => {}}
                onRemindLater={() => {}}
                onInstall={() => {}}
              />
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Sidebar pill (top-left)"
          description="The header pill across phases. Actionable states (available, ready) sit on the primary accent; downloading is muted (not clickable) with a spinner."
        >
          <div className="flex flex-wrap items-end gap-8 rounded-lg border border-border bg-card/60 p-5">
            {(["available", "downloading", "ready"] as const).map((p) => (
              <div key={p} className="flex flex-col items-center gap-2">
                <SidebarUpdatePill
                  phase={p}
                  downloadProgress={p === "downloading" ? 68 : null}
                  onDownloadUpdate={() => {}}
                  onOpenRestartPrompt={() => {}}
                />
                <span className="text-xs text-muted-foreground">{p}</span>
              </div>
            ))}
          </div>
        </PreviewSection>

        <PreviewSection
          title="Production Surfaces"
          description="Live updater components driven by the dev updater mock. The toast renders in the app toast position; the restart dialog renders as the real app modal; the pill below is the real sidebar pill fed by the same mock. Use “+ standard toast” to drop a real app toast beside the update toast and confirm they match."
        >
          <UpdateUiPlaygroundControls />
        </PreviewSection>

        <PreviewSection
          title="Copy deck"
          description="Reference copy for each updater phase. The production surfaces (toast, pill, restart dialog, settings row) draw from these strings."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {UPDATE_PREVIEW_STATES.map((state) => (
              <article
                key={state.id}
                className="rounded-lg border border-border bg-card/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium">{state.title}</h3>
                  <Badge>{state.phase}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{state.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/80">{state.detail}</p>
                <p className="mt-3 text-xs text-muted-foreground">
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
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
