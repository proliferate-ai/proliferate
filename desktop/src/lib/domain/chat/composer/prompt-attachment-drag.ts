export interface FileDragInput {
  types: readonly string[];
  filesLength: number;
}

export interface ChatDropGateInput {
  isEditingQueuedPrompt: boolean;
  isDisabled: boolean;
  areRuntimeControlsDisabled: boolean;
  hasActiveSession: boolean;
  supportsAttachments: boolean;
}

export function readFileDragInput(dataTransfer: DataTransfer): FileDragInput {
  return {
    types: Array.from(dataTransfer.types),
    filesLength: dataTransfer.files.length,
  };
}

export function isFileDrag(input: FileDragInput): boolean {
  return input.filesLength > 0 || input.types.includes("Files");
}

export function canAcceptChatFileDrop(input: ChatDropGateInput): boolean {
  return !input.isEditingQueuedPrompt
    && !input.isDisabled
    && !input.areRuntimeControlsDisabled
    && input.hasActiveSession
    && input.supportsAttachments;
}
