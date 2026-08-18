import type { WorkspacePinLocalOrder } from "#product/lib/domain/preferences/workspace-ui/model";

let rendererEpoch: string | null = null;
let workspacePinLocalSequence = 0;

export function nextWorkspacePinLocalOrder(): WorkspacePinLocalOrder {
  rendererEpoch ??= crypto.randomUUID();
  workspacePinLocalSequence += 1;
  return {
    rendererEpoch,
    sequence: workspacePinLocalSequence,
  };
}

export function resetWorkspacePinLocalOrderForTests(): void {
  rendererEpoch = null;
  workspacePinLocalSequence = 0;
}
