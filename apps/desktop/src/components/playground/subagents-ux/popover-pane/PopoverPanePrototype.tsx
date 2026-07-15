import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ArrowUp, ChevronDown } from "@proliferate/ui/icons";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import {
  ActivityAggregatePopover,
  type PrototypeSourceControlAction,
} from "./ActivityAggregatePopover";
import { GlobalAgentsPanePrototype } from "./GlobalAgentsPanePrototype";
import {
  POPOVER_PANE_SCENARIOS,
  resolvePopoverPaneScenario,
  type PopoverPaneScenarioKey,
} from "./PopoverPaneFixtures";

/**
 * Visual prototyping lane for the aggregate activity popover + the global
 * Agents right pane. Fixture-only, no live session wiring: an app-like
 * composer with the compact attached activity cap on the left, the pane
 * beside it, and scenario controls across the top. The popover's Subagents
 * entry opens the pane drilled into the current parent.
 */
export function PopoverPanePrototype() {
  const [scenarioKey, setScenarioKey] = useState<PopoverPaneScenarioKey>("mixed-states");
  const [paneOpen, setPaneOpen] = useState(true);
  const [paneParentId, setPaneParentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const scenario = resolvePopoverPaneScenario(scenarioKey);
  const paneParentFixtureId = `scenario-parent-${scenario.key}`;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
        <div className="flex flex-col">
          <h1 className="text-sm font-semibold">Aggregate popover + Subagents pane</h1>
          <p className="text-xs text-muted-foreground">
            Click the cap above the composer for the aggregate popover; rows in the pane select.
          </p>
        </div>
        <div role="group" aria-label="Scenario" className="ml-auto flex items-center gap-1">
          {POPOVER_PANE_SCENARIOS.map((candidate) => (
            <Button
              key={candidate.key}
              type="button"
              variant={candidate.key === scenarioKey ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={candidate.key === scenarioKey}
              onClick={() => {
                setScenarioKey(candidate.key);
                setSelectedAgentId(null);
                setPaneParentId(null);
              }}
            >
              {candidate.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant={paneOpen ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={paneOpen}
          onClick={() => setPaneOpen((open) => !open)}
        >
          Right pane
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col justify-end">
          <div className="mx-auto flex w-full max-w-2xl flex-col px-5 pb-6">
            <div className="px-5">
              <ActivityAggregatePopover
                key={scenario.key}
                git={scenario.git}
                agents={scenario.agents}
                onOpenSubagentsPane={() => {
                  setPaneOpen(true);
                  setPaneParentId(paneParentFixtureId);
                }}
                onSourceControlAction={(action) => setLastAction(
                  sourceControlActionLabel(action),
                )}
              />
            </div>
            <PrototypeComposerSurface />
          </div>
        </main>
        {paneOpen ? (
          <aside className="w-72 shrink-0 border-l border-sidebar-border">
            <GlobalAgentsPanePrototype
              parents={scenario.agents.length > 0
                ? [{
                    id: paneParentFixtureId,
                    title: scenario.parentTitle,
                    agents: scenario.agents,
                  }]
                : []}
              archived={scenario.closedAgents.map((agent) => ({
                id: agent.id,
                label: agent.label,
                parentTitle: scenario.parentTitle,
                closedDetail: agent.detail,
              }))}
              selectedParentId={paneParentId}
              activeAgentId={selectedAgentId}
              onSelectParent={(parentId) => setPaneParentId(parentId)}
              onBack={() => setPaneParentId(null)}
              onOpenAgent={(_parentId, agentId) => setSelectedAgentId(agentId)}
              onOpenArchived={(archivedId) => setLastAction(
                `Reopen archived session ${archivedId} in a chat tab (prototype only).`,
              )}
            />
          </aside>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {lastAction}
      </p>
    </div>
  );
}

// Read-only app-like composer surface. The activity cap paints before this so
// the composer's own top outline stays visible at the seam (chat-composer.md §4.1).
export function PrototypeComposerSurface() {
  return (
    <ChatComposerSurface>
      <div className="relative flex flex-col">
        <div
          className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
          style={{ minHeight: "3.5rem" }}
        >
          <Textarea
            variant="ghost"
            rows={2}
            placeholder="Ask for a follow-up"
            spellCheck={false}
            readOnly
            className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center gap-1 px-3 pb-2">
          <ComposerControlButton
            label="Claude"
            detail="Sonnet"
            trailing={<ChevronDown className="size-3" />}
            aria-label="Model (prototype, inert)"
          />
          <ComposerControlButton label="Default" aria-label="Mode (prototype, inert)" />
          <Button
            type="button"
            variant="inverted"
            size="icon-sm"
            aria-label="Send (prototype, inert)"
            className="ml-auto"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </div>
    </ChatComposerSurface>
  );
}

function sourceControlActionLabel(action: PrototypeSourceControlAction): string {
  switch (action) {
    case "review":
      return "Review changes selected (prototype only).";
    case "commit":
      return "Commit selected (prototype only).";
    case "publish":
      return "Publish or push selected (prototype only).";
    case "pull-request":
      return "Pull request selected (prototype only).";
  }
}
