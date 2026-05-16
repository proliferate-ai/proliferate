import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  Copy,
  Plus,
  Trash,
} from "@/components/ui/icons";
import {
  ScratchCodeMirrorEditor,
  type ScratchCodeMirrorEditorHandle,
} from "@/components/workspace/scratch/ScratchCodeMirrorEditor";
import { PaneHeader } from "@/components/workspace/pane/PaneHeader";
import {
  PaneOptionsMenu,
  PaneOptionsMenuItem,
  PaneOptionsMenuSeparator,
} from "@/components/workspace/pane/PaneOptionsMenu";
import { useWorkspaceScratchPad } from "@/hooks/access/tauri/workspace-scratch/use-workspace-scratch-pad";
import { useWorkspaceScratchPadMutations } from "@/hooks/access/tauri/workspace-scratch/use-workspace-scratch-pad-mutations";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

const SAVE_DEBOUNCE_MS = 500;
const SCRATCH_PLACEHOLDER = "☐ Capture follow-ups\n☐ Keep durable workspace notes here";
const COMPLETED_TASK_PATTERN = /^\s*(?:[-*]\s+\[[xX]\]|☑)\s+.*(?:\r?\n|$)/gm;
const COMPLETED_TASK_DETECT_PATTERN = /^\s*(?:[-*]\s+\[[xX]\]|☑)\s+/m;

interface ScratchPadPanelProps {
  workspaceKey: string | null;
}

export function ScratchPadPanel({ workspaceKey }: ScratchPadPanelProps) {
  const editorRef = useRef<ScratchCodeMirrorEditorHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<string | null>(null);
  const saveSequenceRef = useRef(0);
  const workspaceKeyRef = useRef<string | null>(workspaceKey ?? null);
  const previousWorkspaceKeyRef = useRef<string | null>(workspaceKey ?? null);
  const latestDraftRef = useRef("");
  const lastSavedRef = useRef("");
  const scratchQuery = useWorkspaceScratchPad(workspaceKey);
  const {
    writeScratchPad,
    writeScratchPadState,
    setScratchPadCache,
  } = useWorkspaceScratchPadMutations(workspaceKey);
  const { copyText } = useTauriShellActions();
  const [draft, setDraft] = useState("");
  const [wordWrap, setWordWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const hasWorkspace = Boolean(workspaceKey);
  const loading = hasWorkspace && scratchQuery.isLoading;
  const dirty = draft !== lastSavedRef.current;
  const saveStatus = !hasWorkspace
    ? "No workspace"
    : writeScratchPadState.isPending
      ? "Saving"
      : writeScratchPadState.isError
        ? "Save failed"
        : dirty
          ? "Unsaved"
          : "Saved";

  const flushSave = useCallback(async (content: string) => {
    const targetWorkspaceKey = workspaceKeyRef.current;
    if (!targetWorkspaceKey || content === lastSavedRef.current) {
      return;
    }
    if (saveInFlightRef.current) {
      pendingSaveRef.current = content;
      return;
    }

    saveInFlightRef.current = true;
    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    try {
      const result = await writeScratchPad(content, targetWorkspaceKey);
      if (
        workspaceKeyRef.current === targetWorkspaceKey
        && sequence === saveSequenceRef.current
        && content === latestDraftRef.current
      ) {
        lastSavedRef.current = content;
        setScratchPadCache(content, result.updatedAtMs, targetWorkspaceKey);
      }
    } finally {
      saveInFlightRef.current = false;
      const pendingContent = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pendingContent !== null) {
        void flushSave(pendingContent).catch(() => undefined);
      }
    }
  }, [setScratchPadCache, writeScratchPad]);

  const queueSave = useCallback((content: string) => {
    latestDraftRef.current = content;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave(latestDraftRef.current).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => {
    const nextWorkspaceKey = workspaceKey ?? null;
    if (previousWorkspaceKeyRef.current === nextWorkspaceKey) {
      workspaceKeyRef.current = nextWorkspaceKey;
      return;
    }
    previousWorkspaceKeyRef.current = nextWorkspaceKey;
    workspaceKeyRef.current = nextWorkspaceKey;
    saveSequenceRef.current += 1;
    pendingSaveRef.current = null;
    setDraft("");
    latestDraftRef.current = "";
    lastSavedRef.current = "";
  }, [workspaceKey]);

  useEffect(() => {
    if (!scratchQuery.data) {
      return;
    }
    if (
      latestDraftRef.current !== lastSavedRef.current
      && scratchQuery.data.content !== latestDraftRef.current
    ) {
      return;
    }
    setDraft(scratchQuery.data.content);
    latestDraftRef.current = scratchQuery.data.content;
    lastSavedRef.current = scratchQuery.data.content;
  }, [scratchQuery.data]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void flushSave(latestDraftRef.current).catch(() => undefined);
  }, [flushSave]);

  const updateDraft = useCallback((next: string) => {
    setDraft(next);
    queueSave(next);
  }, [queueSave]);

  const handleInsertChecklistItem = useCallback(() => {
    const insertion = "- [ ] ";
    if (!editorRef.current?.insertChecklistItem()) {
      updateDraft(draft ? `${draft}\n${insertion}` : insertion);
    }
  }, [draft, updateDraft]);

  const handleClearCompleted = useCallback(() => {
    updateDraft(draft.replace(COMPLETED_TASK_PATTERN, ""));
  }, [draft, updateDraft]);

  const handleCopyContent = useCallback(async () => {
    await copyText(draft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [copyText, draft]);

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void flushSave(latestDraftRef.current).catch(() => undefined);
  }, [flushSave]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-sidebar-background text-sidebar-foreground">
      <PaneHeader
        left={(
          <div className="flex min-w-0 items-center px-1">
            <span className="truncate text-xs font-medium text-sidebar-foreground">
              Scratch
            </span>
          </div>
        )}
        right={(
          <>
            <span className="max-w-20 truncate text-[11px] leading-4 text-sidebar-muted-foreground">
              {saveStatus}
            </span>
            <ScratchPadOptionsMenu
              canCopy={draft.length > 0}
              canClearCompleted={COMPLETED_TASK_DETECT_PATTERN.test(draft)}
              copied={copied}
              wordWrap={wordWrap}
              onCopyContent={handleCopyContent}
              onInsertChecklistItem={handleInsertChecklistItem}
              onClearCompleted={handleClearCompleted}
              onToggleWordWrap={() => setWordWrap((current) => !current)}
            />
          </>
        )}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScratchCodeMirrorEditor
          ref={editorRef}
          value={draft}
          placeholder={loading ? "Loading scratch..." : SCRATCH_PLACEHOLDER}
          disabled={!hasWorkspace || loading}
          wordWrap={wordWrap}
          onChange={updateDraft}
          onBlur={handleBlur}
        />
      </div>
    </div>
  );
}

function ScratchPadOptionsMenu({
  canCopy,
  canClearCompleted,
  copied,
  wordWrap,
  onCopyContent,
  onInsertChecklistItem,
  onClearCompleted,
  onToggleWordWrap,
}: {
  canCopy: boolean;
  canClearCompleted: boolean;
  copied: boolean;
  wordWrap: boolean;
  onCopyContent: () => void;
  onInsertChecklistItem: () => void;
  onClearCompleted: () => void;
  onToggleWordWrap: () => void;
}) {
  return (
    <PaneOptionsMenu label="Scratch options" className="min-w-[220px]">
      {(close) => (
        <div className="flex flex-col gap-px">
          <PaneOptionsMenuItem
            icon={copied ? <Check /> : <Copy />}
            label={copied ? "Copied content" : "Copy content"}
            disabled={!canCopy}
            onClick={() => {
              void onCopyContent();
              close();
            }}
          />
          <PaneOptionsMenuItem
            icon={<Plus />}
            label="Insert checklist item"
            onClick={() => {
              onInsertChecklistItem();
              close();
            }}
          />
          <PaneOptionsMenuItem
            icon={<Trash />}
            label="Clear completed"
            disabled={!canClearCompleted}
            onClick={() => {
              onClearCompleted();
              close();
            }}
          />
          <PaneOptionsMenuSeparator />
          <PaneOptionsMenuItem
            reserveIconSlot
            icon={wordWrap ? <Check /> : null}
            label="Word wrap"
            trailing={wordWrap ? "On" : "Off"}
            onClick={() => {
              onToggleWordWrap();
              close();
            }}
          />
        </div>
      )}
    </PaneOptionsMenu>
  );
}
