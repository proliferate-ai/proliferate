import { useState } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Input } from "@proliferate/ui/primitives/Input";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Terminal as TerminalIcon,
  X,
} from "@proliferate/ui/icons";

interface TerminalTopBarProps {
  terminals: readonly TerminalRecord[];
  activeTerminalId: string | null;
  unreadByTerminal: Record<string, boolean>;
  isRuntimeReady: boolean;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onNewTerminal: () => void;
}

export function TerminalTopBar({
  terminals,
  activeTerminalId,
  unreadByTerminal,
  isRuntimeReady,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
  onNewTerminal,
}: TerminalTopBarProps) {
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const activeTerminalIndex = terminals.findIndex((terminal) => terminal.id === activeTerminalId);
  const activeTerminal = activeTerminalIndex >= 0 ? terminals[activeTerminalIndex] : null;
  const activeTitle = activeTerminal
    ? terminalDisplayTitle(activeTerminal, activeTerminalIndex)
    : "Terminal";

  const beginRename = (terminal: TerminalRecord, index: number) => {
    setEditingTerminalId(terminal.id);
    setRenameDraft(terminalDisplayTitle(terminal, index));
  };

  const submitRename = (terminalId: string) => {
    const title = renameDraft.trim();
    if (!title || title.length > 160) {
      return;
    }
    setRenamingTerminalId(terminalId);
    onRenameTerminal(terminalId, title)
      .then(() => {
        setEditingTerminalId(null);
      })
      .catch(() => undefined)
      .finally(() => setRenamingTerminalId(null));
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 text-sidebar-foreground">
      <PopoverButton
        align="start"
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <TerminalIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate text-left">{activeTitle}</span>
            <ChevronDown className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
          </Button>
        }
        className="w-72 rounded-md border border-sidebar-border bg-sidebar-background p-1 shadow-floating"
      >
        {(close) => (
          <div className="max-h-80 overflow-y-auto py-0.5">
            {terminals.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-sidebar-muted-foreground">
                No terminals
              </div>
            ) : (
              terminals.map((terminal, index) => {
                const displayTitle = terminalDisplayTitle(terminal, index);
                const isActive = terminal.id === activeTerminalId;
                const isEditing = editingTerminalId === terminal.id;
                const isRenaming = renamingTerminalId === terminal.id;
                return (
                  <div
                    key={terminal.id}
                    className="group/terminal-row flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sidebar-foreground hover:bg-sidebar-accent"
                  >
                    {isEditing ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitRename(terminal.id);
                        }}
                      >
                        <Input
                          value={renameDraft}
                          maxLength={160}
                          autoFocus
                          onChange={(event) => setRenameDraft(event.target.value)}
                          className="h-7 min-w-0 flex-1 border-sidebar-border bg-sidebar-background text-xs text-sidebar-foreground"
                        />
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title="Save terminal title"
                          type="submit"
                          disabled={isRenaming || !renameDraft.trim()}
                        >
                          <Check className="ui-icon" />
                        </IconButton>
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title="Cancel terminal title edit"
                          onClick={() => setEditingTerminalId(null)}
                        >
                          <X className="ui-icon" />
                        </IconButton>
                      </form>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="unstyled"
                          className="min-w-0 flex-1 justify-start gap-2 rounded-md px-1.5 py-1 text-xs text-sidebar-foreground hover:bg-transparent hover:text-sidebar-foreground"
                          onClick={() => {
                            onSelectTerminal(terminal.id);
                            close();
                          }}
                        >
                          <TerminalIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {displayTitle}
                          </span>
                          {unreadByTerminal[terminal.id] && (
                            <span
                              className="size-1.5 rounded-full bg-sidebar-foreground"
                              aria-hidden="true"
                            />
                          )}
                          {isActive && (
                            <span className="text-sm text-sidebar-muted-foreground">
                              Active
                            </span>
                          )}
                        </Button>
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title={`Rename ${displayTitle}`}
                          onClick={() => beginRename(terminal, index)}
                        >
                          <Pencil className="ui-icon" />
                        </IconButton>
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title={`Close ${displayTitle}`}
                          disabled={!isRuntimeReady}
                          onClick={() => {
                            onCloseTerminal(terminal.id);
                            close();
                          }}
                        >
                          <X className="ui-icon" />
                        </IconButton>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </PopoverButton>
      <IconButton
        size="sm"
        tone="sidebar"
        title="New terminal"
        disabled={!isRuntimeReady}
        onClick={onNewTerminal}
      >
        <Plus className="ui-icon" />
      </IconButton>
    </div>
  );
}

function terminalDisplayTitle(terminal: TerminalRecord, index: number): string {
  const fallbackTitle = `Terminal ${index + 1}`;
  return terminal.title === "Terminal" ? fallbackTitle : terminal.title;
}
