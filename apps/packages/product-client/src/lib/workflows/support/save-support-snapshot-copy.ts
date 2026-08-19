export type SupportSnapshotCleanupConfirmation = "confirmed" | "unconfirmed";

export type SupportSnapshotSaveCopyWorkflowResult = {
  state: "saved" | "cancelled" | "save_failed";
  cleanup: SupportSnapshotCleanupConfirmation;
};

export interface SaveSupportSnapshotCopyInput {
  artifactId: string;
  consentEpoch: string;
}

export interface SaveSupportSnapshotCopyDependencies {
  saveArchive: (input: {
    artifactId: string;
    consentEpoch: string;
  }) => Promise<string | null>;
  deleteArtifact: (artifactId: string) => Promise<void>;
}

/** Settles archive truth before exact staged-artifact cleanup truth. */
export async function saveSupportSnapshotCopy(
  input: SaveSupportSnapshotCopyInput,
  deps: SaveSupportSnapshotCopyDependencies,
): Promise<SupportSnapshotSaveCopyWorkflowResult> {
  let state: SupportSnapshotSaveCopyWorkflowResult["state"];
  try {
    const savedFileName = await deps.saveArchive(input);
    state = savedFileName === null ? "cancelled" : "saved";
  } catch {
    state = "save_failed";
  }

  let cleanup: SupportSnapshotCleanupConfirmation;
  try {
    await deps.deleteArtifact(input.artifactId);
    cleanup = "confirmed";
  } catch {
    cleanup = "unconfirmed";
  }
  return { state, cleanup };
}
