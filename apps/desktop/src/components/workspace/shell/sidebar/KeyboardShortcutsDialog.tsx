import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { KeyboardShortcutsPane } from "@/components/settings/panes/KeyboardShortcutsPane";

/**
 * Keyboard-shortcuts modal (UX spec §9): kit Dialog wrapping the existing
 * settings KeyboardShortcutsPane — reused, not duplicated. Opened from the
 * sidebar bottom menu (⌘/ item).
 */
export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className="sr-only">Keyboard shortcuts</DialogTitle>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <KeyboardShortcutsPane />
        </div>
      </DialogContent>
    </Dialog>
  );
}
