import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { SplitButton } from "@/components/workspace/open-target/SplitButton";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Copy,
  Check,
  Pencil,
  SplitPanel,
  SplitPanelRight,
} from "@/components/ui/icons";
import {
  listOpenTargets,
  openTarget as execOpenTarget,
} from "@/platform/tauri/shell";
import type { OpenTarget } from "@/platform/tauri/shell";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/preference-resolvers";
import { useToastStore } from "@/stores/toast/toast-store";

interface TopBarProps {
  branchName?: string;
  additions?: number;
  deletions?: number;
  gitActions?: ReactNode;
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  onTogglePanel?: () => void;
  panelOpen?: boolean;
  workspacePath?: string;
  onRenameBranch?: (newName: string) => Promise<void>;
}

export function TopBar({
  branchName,
  additions,
  deletions,
  gitActions,
  showSidebarToggle,
  onToggleSidebar,
  onTogglePanel,
  panelOpen = true,
  workspacePath,
  onRenameBranch,
}: TopBarProps) {
  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listOpenTargets("directory").then(setTargets);
  }, []);

  const defaultOpenInTargetId = useUserPreferencesStore((state) => state.defaultOpenInTargetId);
  const preferredTarget = resolvePreferredOpenTarget(targets, { defaultOpenInTargetId });
  const showToast = useToastStore((s) => s.show);

  const workspaceName = workspacePath?.split("/").pop() ?? "";

  const handleDefaultOpen = useCallback(() => {
    if (!workspacePath) return;
    const targetId = preferredTarget?.id ?? "finder";
    void execOpenTarget(targetId, workspacePath).catch(() => {});
  }, [workspacePath, preferredTarget]);

  const handleTargetClick = useCallback(
    (targetId: string) => {
      if (!workspacePath) return;
      void execOpenTarget(targetId, workspacePath).catch(() => {});
    },
    [workspacePath],
  );

  const handleCopyBranch = useCallback(() => {
    if (!branchName) return;
    navigator.clipboard.writeText(branchName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [branchName]);

  const startEditing = useCallback(() => {
    if (!branchName || !onRenameBranch) return;
    setEditValue(branchName);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [branchName, onRenameBranch]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditValue("");
  }, []);

  const commitRename = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === branchName || !onRenameBranch) {
      cancelEditing();
      return;
    }
    setRenaming(true);
    try {
      await onRenameBranch(trimmed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Branch rename failed: ${msg}`);
    } finally {
      setRenaming(false);
      setEditing(false);
      setEditValue("");
    }
  }, [editValue, branchName, onRenameBranch, cancelEditing, showToast]);

  const hasStats =
    additions !== undefined &&
    deletions !== undefined &&
    (additions > 0 || deletions > 0);

  return (
    <div
      className="flex justify-between items-center pl-4 pr-2 py-2 h-10 bg-sidebar-background relative border-b !border-sidebar-border"
      data-tauri-drag-region="true"
    >
      {/* Left side -- branch info */}
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden mr-3" data-tauri-drag-region="true">
        {showSidebarToggle && (
          <IconButton onClick={onToggleSidebar} title="Show sidebar">
            <SplitPanel className="size-4" />
          </IconButton>
        )}
        {branchName && !editing && (
          <>

            <Button
              variant="ghost"
              onClick={handleCopyBranch}
              className="text-sm font-medium min-w-0 text-sidebar-foreground group flex items-center relative h-auto px-0 py-0 rounded-none hover:bg-transparent hover:text-foreground"
              title="Click to copy"
              aria-label="Copy branch name"
            >
              <span className="truncate min-w-0">{branchName}</span>
              <span className="ml-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {copied ? (
                  <Check className="size-3 text-git-green" />
                ) : (
                  <Copy className="size-3" />
                )}
              </span>
              {copied && (
                <span className="absolute -bottom-5 left-0 text-[10px] text-git-green whitespace-nowrap">
                  Copied!
                </span>
              )}
            </Button>

            {onRenameBranch && (
              <Button
                variant="ghost"
                size="icon"
                onClick={startEditing}
                className="shrink-0 text-muted-foreground hover:text-foreground h-5 w-5"
                title="Rename branch"
                aria-label="Rename branch"
              >
                <Pencil className="size-3" />
              </Button>
            )}
          </>
        )}
        {branchName && editing && (
          <>
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") cancelEditing();
              }}
              onBlur={() => void commitRename()}
              disabled={renaming}
              className="text-sm font-medium bg-transparent border-sidebar-border focus:ring-0 focus:border-primary min-w-0 flex-1 max-w-[300px] h-7 px-1.5 py-0.5"
              spellCheck={false}
            />
            {renaming && (
              <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                Renaming…
              </span>
            )}
          </>
        )}
      </div>

      {/* Right side -- actions */}
      <div className="flex items-center gap-3 shrink-0">
        <SplitButton
          icon={null}
          label={workspaceName ? `/${workspaceName}` : "Open"}
          onClick={handleDefaultOpen}
          targets={targets}
          onTargetClick={handleTargetClick}
          preferredTarget={preferredTarget}
        />

        {gitActions}

        <Button
          variant="outline"
          onClick={onTogglePanel}
          aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
          title={panelOpen ? "Hide side panel" : "Show side panel"}
          className="h-6 px-2 text-xs rounded-lg font-[450]"
        >
          {hasStats && (
            <>
              <span className="text-git-green">+{additions}</span>
              <span className="text-git-red">-{deletions}</span>
            </>
          )}
          <SplitPanelRight className="size-3.5 text-muted-foreground ml-0.5" />
        </Button>
      </div>
    </div>
  );
}
