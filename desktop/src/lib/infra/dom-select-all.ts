export const SELECT_ALL_COMMAND_EVENT = "proliferate:select-all";
export const UNDO_COMMAND_EVENT = "proliferate:undo";
export const REDO_COMMAND_EVENT = "proliferate:redo";

export function runSelectAllCommand(): boolean {
  if (dispatchEditorCommand(SELECT_ALL_COMMAND_EVENT)) {
    return true;
  }

  return selectActiveTextEntry();
}

export function runUndoCommand(): boolean {
  if (dispatchEditorCommand(UNDO_COMMAND_EVENT)) {
    return true;
  }

  return runDocumentCommand("undo");
}

export function runRedoCommand(): boolean {
  if (dispatchEditorCommand(REDO_COMMAND_EVENT)) {
    return true;
  }

  return runDocumentCommand("redo");
}

export function selectElementContents(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function dispatchEditorCommand(eventName: string): boolean {
  const event = new Event(eventName, { cancelable: true });
  return !window.dispatchEvent(event);
}

function runDocumentCommand(command: string): boolean {
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}

function selectActiveTextEntry(): boolean {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    try {
      activeElement.select();
      return true;
    } catch {
      return false;
    }
  }

  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    document.execCommand("selectAll");
    return true;
  }

  return false;
}
