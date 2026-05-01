import { useState } from "react";
import {
  CommandPaletteGroup,
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPaletteRoot,
  useCommandPaletteClose,
} from "@/components/ui/CommandPalette";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import {
  CommandPaletteGlyph,
} from "@/components/ui/icons";
import { useWorkspaceCommandPalette } from "@/hooks/workspaces/use-workspace-command-palette";
import type {
  CommandPaletteEntry,
  CommandPaletteIconId,
} from "@/lib/domain/command-palette/entries";

interface RunCommandState {
  onRun: () => void;
  canRun: boolean;
  disabledReason: string | null;
  isLaunching: boolean;
}

export interface WorkspaceCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  hasWorkspaceShell: boolean;
  selectedWorkspaceId: string | null;
  hasRuntimeReadyWorkspace: boolean;
  runtimeBlockedReason: string | null;
  repoSettingsHref: string | null;
  canOpenRepositorySettings: boolean;
  repositorySettingsDisabledReason: string | null;
  runCommand: RunCommandState;
  openTerminalPanel: () => boolean;
}

export function WorkspaceCommandPalette(props: WorkspaceCommandPaletteProps) {
  if (!props.open) {
    return null;
  }

  return <WorkspaceCommandPaletteContent {...props} />;
}

function WorkspaceCommandPaletteContent({
  open,
  onClose,
  hasWorkspaceShell,
  selectedWorkspaceId,
  hasRuntimeReadyWorkspace,
  runtimeBlockedReason,
  repoSettingsHref,
  canOpenRepositorySettings,
  repositorySettingsDisabledReason,
  runCommand,
  openTerminalPanel,
}: WorkspaceCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const state = useWorkspaceCommandPalette({
    open,
    query,
    hasWorkspaceShell,
    selectedWorkspaceId,
    hasRuntimeReadyWorkspace,
    runtimeBlockedReason,
    repoSettingsHref,
    canOpenRepositorySettings,
    repositorySettingsDisabledReason,
    runCommand,
    openTerminalPanel,
  });

  return (
    <CommandPaletteRoot
      open={open}
      onClose={onClose}
      label="Command palette"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center border-b border-border/70 px-3">
        <CommandPaletteGlyph
          name="search"
          className="mr-1 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <CommandPaletteInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search files, actions, agents..."
          className="px-0"
        />
      </div>
      <CommandPaletteList>
        {state.groups.map((group) => (
          <CommandPaletteGroup key={group.id} heading={group.label}>
            {group.entries.map((entry) => (
              <WorkspaceCommandPaletteRow key={entry.value} entry={entry} />
            ))}
          </CommandPaletteGroup>
        ))}
        {!state.hasEntries && (
          <div
            className="px-3 py-8 text-center text-xs text-muted-foreground"
            data-telemetry-mask
          >
            No results
          </div>
        )}
        {state.fileSearchError && (
          <div
            className="px-3 py-2 text-xs text-muted-foreground"
            data-telemetry-mask
          >
            Failed to search files.
          </div>
        )}
      </CommandPaletteList>
    </CommandPaletteRoot>
  );
}

function WorkspaceCommandPaletteRow({ entry }: { entry: CommandPaletteEntry }) {
  const close = useCommandPaletteClose();
  const isFile = entry.group === "files";

  return (
    <CommandPaletteItem
      value={entry.value}
      disabled={!!entry.disabledReason}
      onSelect={() => {
        if (entry.disabledReason) {
          return;
        }
        close({ restoreFocus: false });
        window.requestAnimationFrame(() => entry.execute());
      }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {isFile ? (
          <FileTreeEntryIcon
            name={entry.label}
            path={entry.detail ?? entry.label}
            kind="file"
            className="size-4"
          />
        ) : (
          <WorkspaceCommandIcon icon={entry.icon} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{entry.label}</span>
        {entry.detail && (
          <span
            className="min-w-0 truncate text-muted-foreground"
            title={entry.detail}
            data-telemetry-mask
          >
            {entry.detail}
          </span>
        )}
      </span>
      {entry.disabledReason ? (
        <span className="shrink-0 truncate text-[11px] text-muted-foreground">
          {entry.disabledReason}
        </span>
      ) : entry.shortcut ? (
        <span className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[11px] leading-3 text-muted-foreground">
          {entry.shortcut}
        </span>
      ) : null}
    </CommandPaletteItem>
  );
}

function WorkspaceCommandIcon({ icon }: { icon?: CommandPaletteIconId }) {
  return (
    <CommandPaletteGlyph
      name={icon ?? "command"}
      className="size-4"
      aria-hidden="true"
    />
  );
}
