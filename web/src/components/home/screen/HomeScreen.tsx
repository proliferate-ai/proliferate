import { Cloud, GitBranch, Send, Smartphone, Users } from "lucide-react";
import { useState, type ComponentType } from "react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

import { workspaces } from "../../../lib/fixtures/web-fixtures";

type ModeId = "dispatch" | "shared" | "personal";

interface ModeOption {
  id: ModeId;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  placeholder: string;
}

const MODES: ModeOption[] = [
  {
    id: "dispatch",
    label: "Dispatch",
    description: "Lightweight remote task. No setup.",
    icon: Smartphone,
    placeholder: "Describe a quick remote task...",
  },
  {
    id: "shared",
    label: "Shared chat",
    description: "Team work in the shared sandbox. Claimable.",
    icon: Users,
    placeholder: "Ask the shared sandbox to take this on...",
  },
  {
    id: "personal",
    label: "Personal cloud",
    description: "Your repo, your tools, your model.",
    icon: Cloud,
    placeholder: "Ask Proliferate to work in your sandbox...",
  },
];

export function HomeScreen() {
  const [mode, setMode] = useState<ModeId>("dispatch");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const meta = MODES.find((option) => option.id === mode) ?? MODES[0];
  const workspace = workspaces.find((item) => item.id === workspaceId);

  return (
    <div className="web-scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-16">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">What should we run?</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pick a run shape, then send the task.
          </p>
        </header>

        <div className="grid gap-2 rounded-lg border border-border bg-card p-2">
          {MODES.map((option) => {
            const Icon = option.icon;
            const active = option.id === mode;
            return (
              <Button
                key={option.id}
                type="button"
                variant="unstyled"
                size="unstyled"
                onClick={() => setMode(option.id)}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-accent" : "hover:bg-accent/60"
                }`}
              >
                <span
                  className={`flex size-9 items-center justify-center rounded-md border ${
                    active
                      ? "border-border-heavy bg-sidebar text-foreground"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
                <span
                  className={`flex size-4 items-center justify-center rounded-full border ${
                    active ? "border-foreground" : "border-border-heavy"
                  }`}
                >
                  {active ? <span className="size-2 rounded-full bg-foreground" /> : null}
                </span>
              </Button>
            );
          })}
        </div>

        <div className="mt-3 rounded-lg border border-border bg-card p-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-28 w-full resize-none border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            placeholder={meta.placeholder}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            {mode === "personal" ? (
              <div className="flex items-center gap-2">
                <Select
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  className="h-7 w-auto rounded-md border-border bg-background px-2 text-xs focus:border-border-heavy"
                >
                  {workspaces.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GitBranch size={12} />
                  {workspace?.branchLabel ?? "main"}
                </span>
              </div>
            ) : (
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {mode === "dispatch" ? "Mobile-first" : "Team"}
              </span>
            )}
            <Button
              size="sm"
              variant="inverted"
              disabled={!draft.trim()}
              className="rounded-full px-3"
            >
              <Send size={13} />
              {mode === "dispatch" ? "Dispatch" : mode === "shared" ? "Send" : "Run"}
            </Button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Configure agents, models, and skills in Settings.
        </p>
      </div>
    </div>
  );
}
