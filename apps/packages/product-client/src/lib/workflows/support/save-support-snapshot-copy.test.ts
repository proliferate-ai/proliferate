import { describe, expect, it, vi } from "vitest";
import {
  saveSupportSnapshotCopy,
  type SupportSnapshotSaveCopyWorkflowResult,
} from "#product/lib/workflows/support/save-support-snapshot-copy";

interface MatrixCase {
  name: string;
  archive: "saved" | "cancelled" | "rejected";
  deletion: "resolved" | "rejected";
  expected: SupportSnapshotSaveCopyWorkflowResult;
}

const MATRIX: MatrixCase[] = [
  {
    name: "saved archive and confirmed cleanup",
    archive: "saved",
    deletion: "resolved",
    expected: { state: "saved", cleanup: "confirmed" },
  },
  {
    name: "saved archive and unconfirmed cleanup",
    archive: "saved",
    deletion: "rejected",
    expected: { state: "saved", cleanup: "unconfirmed" },
  },
  {
    name: "cancelled dialog and confirmed cleanup",
    archive: "cancelled",
    deletion: "resolved",
    expected: { state: "cancelled", cleanup: "confirmed" },
  },
  {
    name: "cancelled dialog and unconfirmed cleanup",
    archive: "cancelled",
    deletion: "rejected",
    expected: { state: "cancelled", cleanup: "unconfirmed" },
  },
  {
    name: "failed archive and confirmed cleanup",
    archive: "rejected",
    deletion: "resolved",
    expected: { state: "save_failed", cleanup: "confirmed" },
  },
  {
    name: "failed archive and unconfirmed cleanup",
    archive: "rejected",
    deletion: "rejected",
    expected: { state: "save_failed", cleanup: "unconfirmed" },
  },
];

describe("saveSupportSnapshotCopy", () => {
  it.each(MATRIX)("settles $name only after exact cleanup", async ({
    archive,
    deletion,
    expected,
  }) => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", listener);
    try {
      const archiveResult = deferred<string | null>();
      const cleanup = deferred<void>();
      const archiveFailure = new Error("raw archive path /private/report.zip");
      const cleanupFailure = new Error("raw staged path /private/artifact.json");
      const saveArchive = vi.fn(() => archiveResult.promise);
      const deleteArtifact = vi.fn(() => cleanup.promise);

      const resultPromise = saveSupportSnapshotCopy(
        { artifactId: "artifact-1", consentEpoch: "epoch-1" },
        { saveArchive, deleteArtifact },
      );
      let settled = false;
      void resultPromise.then(() => { settled = true; });

      expect(deleteArtifact).not.toHaveBeenCalled();
      if (archive === "rejected") archiveResult.reject(archiveFailure);
      else archiveResult.resolve(archive === "saved" ? "diagnostics.zip" : null);
      await vi.waitFor(() => expect(deleteArtifact).toHaveBeenCalledTimes(1));
      expect(settled).toBe(false);
      expect(saveArchive).toHaveBeenCalledTimes(1);
      expect(saveArchive).toHaveBeenCalledWith({
        artifactId: "artifact-1",
        consentEpoch: "epoch-1",
      });
      expect(deleteArtifact).toHaveBeenCalledWith("artifact-1");

      if (deletion === "resolved") cleanup.resolve();
      else cleanup.reject(cleanupFailure);

      const result = await resultPromise;
      expect(result).toEqual(expected);
      expect(Object.keys(result).sort()).toEqual(["cleanup", "state"]);
      expect(JSON.stringify(result)).not.toContain("diagnostics.zip");
      expect(JSON.stringify(result)).not.toContain("/private/");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
