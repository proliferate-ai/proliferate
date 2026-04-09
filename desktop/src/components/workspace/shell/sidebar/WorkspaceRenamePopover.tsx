import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PopoverButton } from "@/components/ui/PopoverButton";

interface WorkspaceRenamePopoverProps {
  /**
   * The current resolved display name (the text the sidebar is showing today).
   * Used as the initial value when the popover opens.
   */
  currentName: string;
  /**
   * The default name we would fall back to if no override were set
   * (branch- or repo-derived). Shown as input placeholder so the user knows
   * what clearing the override will reveal.
   */
  defaultName: string;
  /** Whether the workspace currently has an override set. */
  hasOverride: boolean;
  trigger: ReactElement<{
    onClick?: (...args: unknown[]) => void;
    onDoubleClick?: (...args: unknown[]) => void;
    onContextMenu?: (...args: unknown[]) => void;
    ref?: Ref<HTMLElement>;
  }>;
  /**
   * Persist the override. `null` clears it. The hook should treat empty as
   * clearing — but the popover only ever sends `null` (clear) or a
   * non-empty trimmed string.
   */
  onRename: (name: string | null) => Promise<unknown>;
  externalOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function WorkspaceRenamePopover({
  currentName,
  defaultName,
  hasOverride,
  trigger,
  onRename,
  externalOpen,
  onOpenChange,
}: WorkspaceRenamePopoverProps) {
  return (
    <PopoverButton
      trigger={trigger}
      // Inert auto-trigger: this popover is opened programmatically via
      // `externalOpen` from the sidebar context-menu "Rename" item. The
      // surrounding context popover stops click propagation, so the
      // doubleClick handler never fires from row interactions either.
      triggerMode="doubleClick"
      align="start"
      side="bottom"
      offset={6}
      className="w-72 rounded-xl border border-border bg-popover p-3 shadow-floating"
      externalOpen={externalOpen}
      onOpenChange={onOpenChange}
    >
      {(close) => (
        <WorkspaceRenamePanel
          currentName={currentName}
          defaultName={defaultName}
          hasOverride={hasOverride}
          onClose={close}
          onRename={onRename}
        />
      )}
    </PopoverButton>
  );
}

function WorkspaceRenamePanel({
  currentName,
  defaultName,
  hasOverride,
  onClose,
  onRename,
}: {
  currentName: string;
  defaultName: string;
  hasOverride: boolean;
  onClose: () => void;
  onRename: (name: string | null) => Promise<unknown>;
}) {
  const [value, setValue] = useState(currentName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(currentName);
    setError(null);
  }, [currentName]);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const trimmed = value.trim();

    setIsSaving(true);
    setError(null);
    try {
      // Empty input means "clear the override".
      await onRename(trimmed.length === 0 ? null : trimmed);
      onClose();
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "Could not rename workspace.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onClose, onRename, value]);

  const handleReset = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onRename(null);
      onClose();
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "Could not reset workspace name.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onClose, onRename]);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground">Rename workspace</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Override the default workspace label. Clear the field to restore the default.
        </div>
      </div>
      <Input
        ref={inputRef}
        value={value}
        placeholder={defaultName}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) {
            setError(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void handleSave();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        disabled={isSaving}
        spellCheck={false}
        maxLength={160}
        className="h-9"
      />
      {error && (
        <div className="text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div>
          {hasOverride && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleReset();
              }}
              disabled={isSaving}
            >
              Reset
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
