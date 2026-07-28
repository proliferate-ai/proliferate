import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  FileCode,
  FileText,
  GitBranch,
  GitPullRequest,
  MessageSquarePlus,
  Settings,
  SquareTerminal,
  Terminal,
} from "@proliferate/ui";

export const FileSearch = () => (
  <Command className="h-72 w-96 rounded-lg border border-border">
    <CommandInput placeholder="Search files by path…" />
    <CommandList>
      <CommandEmpty>No files match that path.</CommandEmpty>
      <CommandGroup heading="Recently edited">
        <CommandItem value="ComposerTextarea">
          <FileCode className="icon-paired text-muted-foreground" />
          <span>patterns/ComposerTextarea.tsx</span>
          <CommandShortcut>+12 −3</CommandShortcut>
        </CommandItem>
        <CommandItem value="Command primitive">
          <FileCode className="icon-paired text-muted-foreground" />
          <span>primitives/Command.tsx</span>
          <CommandShortcut>+41</CommandShortcut>
        </CommandItem>
        <CommandItem value="theme tokens">
          <FileText className="icon-paired text-muted-foreground" />
          <span>design/src/tokens/theme.css</span>
          <CommandShortcut>+6 −6</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Tracked in this branch">
        <CommandItem value="AGENTS.md">
          <FileText className="icon-paired text-muted-foreground" />
          <span>AGENTS.md</span>
        </CommandItem>
        <CommandItem value="Makefile">
          <Terminal className="icon-paired text-muted-foreground" />
          <span>Makefile</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);

export const ActionMenu = () => (
  <Command className="h-72 w-96 rounded-lg border border-border">
    <CommandInput placeholder="Type a command or search…" />
    <CommandList>
      <CommandEmpty>No commands found.</CommandEmpty>
      <CommandGroup heading="Session">
        <CommandItem value="new chat">
          <MessageSquarePlus className="icon-paired text-muted-foreground" />
          <span>New chat</span>
          <CommandShortcut>⌘N</CommandShortcut>
        </CommandItem>
        <CommandItem value="open terminal">
          <SquareTerminal className="icon-paired text-muted-foreground" />
          <span>Open terminal pane</span>
          <CommandShortcut>⌃`</CommandShortcut>
        </CommandItem>
        <CommandItem value="settings">
          <Settings className="icon-paired text-muted-foreground" />
          <span>Open settings</span>
          <CommandShortcut>⌘,</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Git">
        <CommandItem value="switch branch">
          <GitBranch className="icon-paired text-muted-foreground" />
          <span>Switch branch…</span>
          <CommandShortcut>⌘⇧B</CommandShortcut>
        </CommandItem>
        <CommandItem value="open pull request" disabled>
          <GitPullRequest className="icon-paired text-muted-foreground" />
          <span>Open pull request</span>
          <CommandShortcut>needs a push</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);

export const NoResults = () => {
  const [search, setSearch] = useState("supabase migration");
  return (
    <Command className="h-72 w-96 rounded-lg border border-border">
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search files by path…"
      />
      <CommandList>
        <CommandEmpty>
          No files match “{search}” in anthropics/proliferate.
        </CommandEmpty>
        <CommandGroup heading="Recently edited">
          <CommandItem value="ComposerTextarea">
            <FileCode className="icon-paired text-muted-foreground" />
            <span>patterns/ComposerTextarea.tsx</span>
          </CommandItem>
          <CommandItem value="Command primitive">
            <FileCode className="icon-paired text-muted-foreground" />
            <span>primitives/Command.tsx</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
};
