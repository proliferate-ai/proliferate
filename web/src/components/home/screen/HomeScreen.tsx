import { ArrowRight, Bot, Cloud, GitBranch, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@proliferate/ui/primitives/Button";
import { chatKindPresentation } from "@proliferate/product-model/chats/presentation";

import { routes } from "../../../config/routes";
import {
  automations,
  chatCountsByKind,
  chats,
  workspaces,
  workspaceForChat,
} from "../../../lib/fixtures/web-fixtures";

const modeOptions = [
  { id: "personal", label: "Personal", icon: Cloud },
  { id: "team", label: "Team", icon: Users },
  { id: "automation", label: "Automation", icon: Bot },
] as const;

type ModeId = (typeof modeOptions)[number]["id"];

export function HomeScreen() {
  const [mode, setMode] = useState<ModeId>("personal");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const navigate = useNavigate();
  const counts = useMemo(() => chatCountsByKind(), []);
  const recentChats = chats.slice(0, 4);

  return (
    <div className="web-scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-10">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Cloud command center
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Start or continue work</h1>
        </header>

        <section className="rounded-lg border border-border bg-card p-4 shadow-floating">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-md border border-border bg-background p-1">
              {modeOptions.map((option) => {
                const Icon = option.icon;
                const active = option.id === mode;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-medium transition-colors ${
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon size={14} />
                    {option.label}
                  </button>
                );
              })}
            </div>
            <select
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              className="h-9 min-w-56 rounded-md border border-input bg-surface-control px-3 text-xs text-foreground outline-none"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} - {workspace.repoLabel}
                </option>
              ))}
            </select>
          </div>

          <textarea
            className="min-h-32 w-full resize-none rounded-md border border-input bg-background p-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            placeholder={
              mode === "team"
                ? "Ask the shared sandbox to handle a team task..."
                : mode === "automation"
                  ? "Set up a recurring automation..."
                  : "Ask Proliferate to work in your cloud sandbox..."
            }
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <GitBranch size={14} />
              <span>{workspaces.find((workspace) => workspace.id === workspaceId)?.branchLabel ?? "main"}</span>
            </div>
            <Button size="md">
              <Plus size={15} />
              Start
            </Button>
          </div>
        </section>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Recent sessions</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate(routes.automations)}>
                Automations
                <ArrowRight size={14} />
              </Button>
            </div>
            <div className="grid gap-2">
              {recentChats.map((chat) => {
                const presentation = chatKindPresentation(chat.kind);
                const workspace = workspaceForChat(chat);
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => navigate(routes.chat(chat.workspaceId, chat.id))}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{chat.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {presentation.label} - {workspace?.repoLabel ?? "Unknown repo"}
                      </span>
                    </span>
                    <ArrowRight size={15} className="shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Workspace mix</h2>
            <div className="grid gap-2">
              {Object.entries(counts).map(([kind, count]) => {
                const presentation = chatKindPresentation(kind as keyof typeof counts);
                return (
                  <div key={kind} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                    <span>
                      <span className="block text-sm font-medium">{presentation.label}</span>
                      <span className="block text-xs text-muted-foreground">{presentation.description}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-card p-3">
              <h3 className="text-sm font-medium">Next automation</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {automations[0]?.name} - {automations[0]?.scheduleLabel}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
