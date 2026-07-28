import type { ReactNode } from "react";
import { SessionControlIcon } from "@proliferate/ui";

/**
 * `SessionControlIcon` maps a `SessionControlIconKey` to the filled glyph the
 * chat session-control row uses (mode chips, provider chips, the branch chip).
 * It is icon-only, so every cell puts it back in the chrome the product wraps
 * it in — a labelled swatch grid, and the real composer control pills.
 */
const KEYS = [
  ["claude", "Claude"],
  ["openai", "OpenAI"],
  ["sparkles", "Sparkles"],
  ["plan", "Plan mode"],
  ["build", "Build mode"],
  ["edit", "Edit mode"],
  ["read", "Read mode"],
  ["opencodePlan", "Opencode plan"],
  ["opencodeBuild", "Opencode build"],
  ["chat", "Chat"],
  ["branch", "Branch"],
  ["shieldCheck", "Auto-approve"],
  ["zap", "Fast mode"],
];

function Swatch({ icon, label }: { icon: string | null; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5">
      <span className="flex size-5 items-center justify-center text-muted-foreground">
        <SessionControlIcon icon={icon} className="icon-paired" />
      </span>
      <span className="min-w-0 truncate text-ui-sm text-foreground">{label}</span>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border bg-surface-control px-2 py-1 text-ui text-foreground">
      {children}
    </span>
  );
}

export const IconKeys = () => (
  <div className="grid w-full max-w-2xl grid-cols-3 gap-2">
    {KEYS.map(([icon, label]) => (
      <Swatch key={icon} icon={icon} label={label} />
    ))}
  </div>
);

export const ComposerControlRow = () => (
  <div className="flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-lg border border-border bg-composer-background px-3 py-2">
    <Pill>
      <SessionControlIcon icon="claude" className="icon-paired shrink-0 text-muted-foreground" />
      Claude Opus 4.6
    </Pill>
    <Pill>
      <SessionControlIcon icon="build" className="icon-paired shrink-0 text-muted-foreground" />
      Build
    </Pill>
    <Pill>
      <SessionControlIcon icon="branch" className="icon-paired shrink-0 text-muted-foreground" />
      feature/session-activity
    </Pill>
    <Pill>
      <SessionControlIcon icon="shieldCheck" className="icon-paired shrink-0 text-success" />
      Auto-approve edits
    </Pill>
  </div>
);

export const HandoffModeOptions = () => (
  <div className="w-64 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover">
    {[
      ["plan", "Plan", "Draft the change first"],
      ["build", "Build", "Apply the plan directly"],
      ["read", "Read", "Investigate only"],
    ].map(([icon, label, detail]) => (
      <div
        key={icon}
        className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
      >
        <SessionControlIcon
          icon={icon}
          className="icon-paired mt-0.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0">
          <span className="block text-ui text-foreground">{label}</span>
          <span className="block text-ui-sm text-muted-foreground">{detail}</span>
        </span>
      </div>
    ))}
  </div>
);

export const UnknownFallback = () => (
  <div className="flex w-full max-w-md flex-col gap-2">
    <div className="flex items-center gap-3">
      <Swatch icon={null} label="null → CircleQuestion" />
      <Swatch icon={undefined} label="undefined → CircleQuestion" />
    </div>
    <p className="text-ui-sm text-muted-foreground">
      An absent icon key falls back to the outlined question glyph rather than
      collapsing the control's leading slot.
    </p>
  </div>
);
