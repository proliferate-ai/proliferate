import { useCallback, useState } from "react";
import type {
  FileChangeContentPart,
  FileReadContentPart,
  TerminalOutputContentPart,
  ToolCallContentPart,
  ToolCallItem,
  ToolResultTextContentPart,
} from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { FileDiffCard } from "@/components/ui/content/FileDiffCard";
import { HighlightedCodePanel } from "@/components/ui/content/HighlightedCodePanel";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { ChevronRight } from "@/components/ui/icons";
import { useOpenInDefaultEditor } from "@/hooks/editor/use-open-in-default-editor";
import { useWorkspacePath } from "@/providers/WorkspacePathProvider";
import {
  classifyCollapsedAction,
  getToolCallParsedCommands,
  getToolCallShellCommand,
  type ParsedToolCommand,
} from "@/lib/domain/chat/transcript-presentation";
import { describeToolCallDisplay } from "@/lib/domain/chat/tool-call-display";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tool-call-layout";
import { normalizeToolResultText } from "@/lib/domain/chat/tool-result-text";

const CHAT_BUTTON_TEXT_CLASS = "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function CollapsedActionRows({ item }: { item: ToolCallItem }) {
  const parsedCommands = getToolCallParsedCommands(item);
  if (parsedCommands.length > 0) {
    return <ParsedCommandRows item={item} commands={parsedCommands} />;
  }

  switch (classifyCollapsedAction(item)) {
    case "read":
      return <ReadRows item={item} />;
    case "listing":
      return <PlainActionRow tone={item.status === "failed" ? "failed" : "normal"} label={formatListingLabel(item)} />;
    case "search":
      return <PlainActionRow tone={item.status === "failed" ? "failed" : "normal"} label={formatSearchLabel(item)} />;
    case "fetch":
      return <PlainActionRow tone={item.status === "failed" ? "failed" : "normal"} label={formatFetchLabel(item)} />;
    case "command":
      return <CommandActionRow item={item} />;
    case "edit":
      return <EditRows item={item} />;
    case "action":
    default:
      return <GenericActionRow item={item} />;
  }
}

function ReadRows({ item }: { item: ToolCallItem }) {
  const fileReads = item.contentParts.filter(
    (part): part is FileReadContentPart => part.type === "file_read",
  );
  const paths = fileReads.length > 0
    ? fileReads.map((part) => part.basename || basename(part.workspacePath ?? part.path))
    : [deriveReadPath(item)];

  return (
    <>
      {paths.map((path, idx) => (
        <PlainActionRow
          key={`${item.itemId}-read-${idx}`}
          tone={item.status === "failed" ? "failed" : "normal"}
          label={`${item.status === "in_progress" ? "Reading" : "Read"} ${path}`}
        />
      ))}
    </>
  );
}

function ParsedCommandRows({
  item,
  commands,
}: {
  item: ToolCallItem;
  commands: ParsedToolCommand[];
}) {
  return (
    <>
      {commands.map((command, idx) => (
        <PlainActionRow
          key={`${item.itemId}-parsed-${idx}`}
          tone={item.status === "failed" ? "failed" : "normal"}
          label={formatParsedCommandLabel(item, command)}
        />
      ))}
    </>
  );
}

function EditRows({ item }: { item: ToolCallItem }) {
  const fileChanges = item.contentParts.filter(
    (part): part is FileChangeContentPart => part.type === "file_change",
  );

  if (fileChanges.length === 0) {
    return (
      <GenericActionRow item={item} />
    );
  }

  return (
    <>
      {fileChanges.map((part, idx) => (
        <EditActionRow
          key={`${item.itemId}-edit-${idx}`}
          part={part}
          failed={item.status === "failed"}
        />
      ))}
    </>
  );
}

function PlainActionRow({
  label,
  tone = "normal",
}: {
  label: string;
  tone?: "normal" | "failed";
}) {
  return (
    <div
      title={label}
      className={`truncate text-chat leading-[var(--text-chat--line-height)] ${
        tone === "failed" ? "text-destructive/80" : "text-muted-foreground/80"
      }`}
    >
      {label}
    </div>
  );
}

function CommandActionRow({ item }: { item: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const command = deriveCommand(item);
  const output = deriveCommandOutput(item);
  const label = item.status === "failed"
    ? `Command failed with ${command}`
    : formatRunningCommandLabel(command);

  return (
    <div>
      <ActionDisclosureRow
        label={label}
        expanded={expanded}
        failed={item.status === "failed"}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.04]">
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-sm text-muted-foreground">
            <span>Shell</span>
          </div>
          <div className="px-2 pb-2">
            <code className="block whitespace-pre-wrap break-words font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-muted-foreground">
              $ {command}
            </code>
          </div>
          <AutoHideScrollArea
            className="border-t border-border/60"
            viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            allowHorizontal
          >
            <pre className="m-0 whitespace-pre-wrap p-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-muted-foreground">
              <code>{output || "No output"}</code>
            </pre>
          </AutoHideScrollArea>
        </div>
      )}
    </div>
  );
}

function EditActionRow({
  part,
  failed,
}: {
  part: FileChangeContentPart;
  failed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(true);
  const pathLabel = part.newWorkspacePath ?? part.workspacePath ?? part.newPath ?? part.path;
  const displayName = part.newBasename ?? part.basename ?? basename(pathLabel);
  const action = failed ? "Failed editing" : formatEditVerb(part.operation);
  const additions = part.additions ?? 0;
  const deletions = part.deletions ?? 0;
  const hasDetails = !!part.patch || !!part.preview;
  const { resolveAbsolute } = useWorkspacePath();
  const { openInDefaultEditor } = useOpenInDefaultEditor();
  const workspacePath = part.newWorkspacePath ?? part.workspacePath ?? null;
  const absolute = workspacePath ? resolveAbsolute(workspacePath) : null;
  const handleOpen = useCallback(() => {
    if (!absolute) return;
    void openInDefaultEditor(absolute);
  }, [absolute, openInDefaultEditor]);

  return (
    <div>
      <div
        role={hasDetails ? "button" : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        {...(hasDetails ? { "data-chat-transcript-ignore": true } : {})}
        className="group/action-row flex min-w-0 items-center gap-1 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground/80"
        onClick={() => {
          if (hasDetails) setExpanded((value) => !value);
        }}
        onKeyDown={(event) => {
          if (
            hasDetails
            && event.target === event.currentTarget
            && (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
      >
        <span className={failed ? "shrink-0 text-destructive/80" : "shrink-0 group-hover/action-row:text-foreground"}>
          {action}
        </span>
        <ActionFileLink
          pathLabel={pathLabel}
          workspacePath={part.newWorkspacePath ?? part.workspacePath ?? null}
          displayName={displayName}
        />
        {(additions > 0 || deletions > 0) && (
          <span className="inline-flex shrink-0 items-center gap-1 tabular-nums tracking-tight text-sm">
            {additions > 0 && <span className="text-git-green">+{additions}</span>}
            {deletions > 0 && <span className="text-git-red">-{deletions}</span>}
          </span>
        )}
        {hasDetails && (
          <ChevronRight
            className={`ml-0.5 size-3 shrink-0 text-faint opacity-0 transition-all duration-200 group-hover/action-row:opacity-100 ${
              expanded ? "rotate-90 opacity-100" : ""
            }`}
          />
        )}
      </div>
      {expanded && hasDetails && (
        part.patch ? (
          <div className="mt-1.5">
            <FileDiffCard
              filePath={pathLabel}
              additions={additions}
              deletions={deletions}
              isExpanded={diffExpanded}
              onToggleExpand={() => setDiffExpanded((value) => !value)}
              onOpenFile={absolute ? handleOpen : undefined}
            >
              <DiffViewer
                patch={part.patch}
                filePath={pathLabel}
                className="w-full"
                variant="chat"
              />
            </FileDiffCard>
          </div>
        ) : part.preview ? (
          <HighlightedCodePanel
            code={part.preview}
            filename={pathLabel}
            showLanguageLabel={false}
            className="mt-1.5 border-border/60 bg-foreground/[0.04]"
          />
        ) : null
      )}
    </div>
  );
}

function ActionDisclosureRow({
  label,
  expanded,
  failed,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  failed: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal hover:bg-transparent focus-visible:ring-0 ${
        failed ? "text-destructive/80 hover:text-destructive" : "text-muted-foreground/80 hover:text-foreground"
      }`}
      onClick={onToggle}
    >
      <span className="min-w-0 truncate">{label}</span>
      <ChevronRight
        className={`size-3 shrink-0 text-faint opacity-0 transition-all duration-200 group-hover/action-row:opacity-100 group-focus-visible/action-row:opacity-100 ${
          expanded ? "rotate-90 opacity-100" : ""
        }`}
      />
    </Button>
  );
}

function GenericActionRow({ item }: { item: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const toolCallPart = item.contentParts.find(
    (part): part is ToolCallContentPart => part.type === "tool_call",
  );
  const toolName = toolCallPart?.title ?? item.title ?? item.nativeToolName ?? "Tool call";
  const display = describeToolCallDisplay(item, toolName);
  const label = item.status === "failed"
    ? `${display.label} failed`
    : item.status === "in_progress"
      ? `${display.label} running`
      : display.label;
  const output = deriveGenericToolOutput(item);

  if (output) {
    return (
      <div>
        <ActionDisclosureRow
          label={display.hint ? `${label} ${display.hint}` : label}
          expanded={expanded}
          failed={item.status === "failed"}
          onToggle={() => setExpanded((value) => !value)}
        />
        {expanded && (
          <div className="mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.04]">
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-sm text-muted-foreground">
              <span>Result</span>
            </div>
            <AutoHideScrollArea
              className="border-t border-border/60"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              allowHorizontal
            >
              <pre className="m-0 whitespace-pre-wrap p-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-muted-foreground">
                <code>{output}</code>
              </pre>
            </AutoHideScrollArea>
          </div>
        )}
      </div>
    );
  }

  return (
    <PlainActionRow
      tone={item.status === "failed" ? "failed" : "normal"}
      label={display.hint ? `${label} ${display.hint}` : label}
    />
  );
}

function ActionFileLink({
  pathLabel,
  workspacePath,
  displayName,
}: {
  pathLabel: string;
  workspacePath: string | null;
  displayName: string;
}) {
  const { resolveAbsolute } = useWorkspacePath();
  const { openInDefaultEditor } = useOpenInDefaultEditor();
  const absolute = workspacePath ? resolveAbsolute(workspacePath) : null;
  const handleOpen = useCallback(() => {
    if (!absolute) return;
    void openInDefaultEditor(absolute);
  }, [absolute, openInDefaultEditor]);

  if (!absolute) {
    return (
      <span title={pathLabel} className="min-w-0 truncate text-link-foreground">
        {displayName}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      title={pathLabel}
      className={`h-auto min-w-0 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal text-link-foreground hover:bg-transparent hover:underline focus-visible:ring-0 focus-visible:underline`}
      onClick={(event) => {
        event.stopPropagation();
        handleOpen();
      }}
    >
      <span className="min-w-0 truncate">{displayName}</span>
    </Button>
  );
}

function formatSearchLabel(item: ToolCallItem): string {
  const shellCommand = getToolCallShellCommand(item);
  if (shellCommand) {
    return `Searched files with ${shellCommand}`;
  }

  const rawInput = asRecord(item.rawInput);
  const pattern = readString(rawInput?.pattern)
    ?? readString(rawInput?.query)
    ?? readString(rawInput?.q);
  const path = readString(rawInput?.path)
    ?? readString(rawInput?.glob)
    ?? readString(rawInput?.include);
  if (pattern && path) {
    return `Searched for ${pattern} in ${path}`;
  }
  if (pattern) {
    return `Searched for ${pattern}`;
  }
  return "Searched";
}

function formatListingLabel(item: ToolCallItem): string {
  const shellCommand = getToolCallShellCommand(item);
  if (shellCommand) {
    return `Listed files with ${shellCommand}`;
  }
  return "Listed files";
}

function formatFetchLabel(item: ToolCallItem): string {
  const rawInput = asRecord(item.rawInput);
  const url = readString(rawInput?.url) ?? readString(rawInput?.href);
  return url ? `Fetched ${url}` : "Fetched";
}

function deriveCommand(item: ToolCallItem): string {
  const shellCommand = getToolCallShellCommand(item);
  if (shellCommand) return shellCommand;
  const rawInput = asRecord(item.rawInput);
  const command = readString(rawInput?.command) ?? readString(rawInput?.cmd);
  if (command) return command;
  if (
    item.semanticKind === "terminal"
    || item.toolKind === "execute"
    || item.nativeToolName === "Bash"
  ) {
    return "command";
  }
  const toolCallPart = item.contentParts.find(
    (part): part is ToolCallContentPart => part.type === "tool_call",
  );
  return toolCallPart?.title ?? item.title ?? item.nativeToolName ?? "command";
}

function deriveCommandOutput(item: ToolCallItem): string {
  const terminalOutput = item.contentParts
    .filter((part): part is TerminalOutputContentPart => part.type === "terminal_output")
    .filter((part) => part.event === "output" && part.data)
    .map((part) => part.data ?? "")
    .join("");
  if (terminalOutput) {
    return terminalOutput;
  }
  const toolResultText = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text)
    .join("\n\n");
  return normalizeToolResultText(toolResultText || (typeof item.rawOutput === "string" ? item.rawOutput : ""));
}

function deriveGenericToolOutput(item: ToolCallItem): string {
  const toolResultText = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text)
    .join("\n\n");
  if (toolResultText.trim()) {
    return normalizeToolResultText(toolResultText);
  }

  if (typeof item.rawOutput === "string") {
    return normalizeToolResultText(item.rawOutput);
  }

  if (item.rawOutput && typeof item.rawOutput === "object") {
    return JSON.stringify(item.rawOutput, null, 2);
  }

  return "";
}

function deriveReadPath(item: ToolCallItem): string {
  const rawInput = asRecord(item.rawInput);
  const path = readString(rawInput?.file_path)
    ?? readString(rawInput?.path)
    ?? readString(rawInput?.url);
  return basename(path ?? item.title ?? item.nativeToolName ?? "file");
}

function formatParsedCommandLabel(
  item: ToolCallItem,
  command: ParsedToolCommand,
): string {
  const active = item.status === "in_progress";
  const target = command.name
    ?? (command.path ? basename(command.path) : null)
    ?? command.command;

  switch (command.kind) {
    case "read":
      return `${active ? "Reading" : "Read"} ${target ?? "file"}`;
    case "listing":
      return `${active ? "Listing" : "Listed"} ${target ?? "files"}`;
    case "search": {
      const query = command.query ? ` for ${command.query}` : "";
      const scope = command.path ? ` in ${command.path}` : "";
      if (query || scope) {
        return `${active ? "Searching" : "Searched"}${query}${scope}`;
      }
      return `${active ? "Searching" : "Searched"}${command.command ? ` with ${command.command}` : ""}`;
    }
    case "fetch":
      return `${active ? "Fetching" : "Fetched"} ${target ?? "resource"}`;
    case "command":
      return formatRunningCommandLabel(command.command ?? "command");
    case "action":
    default:
      return formatRunningCommandLabel(command.command ?? target ?? "action");
  }
}

function formatRunningCommandLabel(command: string): string {
  const normalizedCommand = command.trim();
  if (!normalizedCommand || normalizedCommand === "command") {
    return "Running command";
  }
  return `Running command ${normalizedCommand}`;
}

function formatEditVerb(operation: FileChangeContentPart["operation"]): string {
  switch (operation) {
    case "create":
      return "Created";
    case "delete":
      return "Deleted";
    case "move":
      return "Moved";
    case "edit":
    default:
      return "Edited";
  }
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
