import { useCallback, useRef, useState } from "react";
import { generateGitPublish } from "@proliferate/cloud-sdk/client/ai-magic";
import type {
  CommitDialogDerivedState,
  GenerationStatus,
} from "@/lib/domain/workspaces/creation/commit-dialog-state";
import { useAiMagicAvailability } from "@/hooks/settings/derived/use-ai-magic-availability";
import { useGitPublishInstructions } from "@/hooks/settings/derived/use-git-publish-instructions";

export interface CommitGenerationState {
  /** Whether AI generation is available at all (auth gated). */
  available: boolean;
  /** Current generation status for commit message. */
  commitStatus: GenerationStatus;
  /** Current generation status for PR fields. */
  prStatus: GenerationStatus;
  /** Generate a commit message from the current diff context. Returns the message or null. */
  generateCommitMessage: (derived: CommitDialogDerivedState) => Promise<string | null>;
  /** Generate PR title+body from the current diff context. Returns {title, body} or null. */
  generatePrFields: (derived: CommitDialogDerivedState) => Promise<{ title: string; body: string } | null>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCommitGeneration(sourceRoot?: string | null): CommitGenerationState {
  const available = useAiMagicAvailability();
  const instructions = useGitPublishInstructions(sourceRoot);
  const [commitStatus, setCommitStatus] = useState<GenerationStatus>("idle");
  const [prStatus, setPrStatus] = useState<GenerationStatus>("idle");

  // Abort tracking for concurrent calls
  const commitAbortRef = useRef(0);
  const prAbortRef = useRef(0);

  const generateCommitMessage = useCallback(async (
    derived: CommitDialogDerivedState,
  ): Promise<string | null> => {
    if (!available) return null;

    const callId = ++commitAbortRef.current;
    setCommitStatus("generating");

    try {
      const promptText = buildDiffPrompt(derived);
      const response = await generateGitPublish({
        promptText,
        mode: "commit_message",
        instructions: instructions || undefined,
      });

      // Stale call guard
      if (callId !== commitAbortRef.current) return null;

      const message = response.commitMessage?.trim() || null;
      setCommitStatus(message ? "idle" : "failed");
      return message;
    } catch {
      if (callId === commitAbortRef.current) {
        setCommitStatus("failed");
      }
      return null;
    }
  }, [available, instructions]);

  const generatePrFields = useCallback(async (
    derived: CommitDialogDerivedState,
  ): Promise<{ title: string; body: string } | null> => {
    if (!available) return null;

    const callId = ++prAbortRef.current;
    setPrStatus("generating");

    try {
      const promptText = buildDiffPrompt(derived);
      const response = await generateGitPublish({
        promptText,
        mode: "pull_request",
        instructions: instructions || undefined,
      });

      // Stale call guard
      if (callId !== prAbortRef.current) return null;

      const title = response.prTitle?.trim() || null;
      const body = response.prBody?.trim() || "";
      if (!title) {
        setPrStatus("failed");
        return null;
      }
      setPrStatus("idle");
      return { title, body };
    } catch {
      if (callId === prAbortRef.current) {
        setPrStatus("failed");
      }
      return null;
    }
  }, [available, instructions]);

  return {
    available,
    commitStatus,
    prStatus,
    generateCommitMessage,
    generatePrFields,
  };
}

// ---------------------------------------------------------------------------
// Internal: build a diff summary string for the AI prompt
// ---------------------------------------------------------------------------

function buildDiffPrompt(derived: CommitDialogDerivedState): string {
  const parts: string[] = [];

  if (derived.branchName) {
    parts.push(`Branch: ${derived.branchName}`);
  }

  const allFiles = [
    ...derived.fileGroups.staged,
    ...derived.fileGroups.partial,
    ...derived.fileGroups.unstaged,
  ];

  if (allFiles.length > 0) {
    parts.push(`Changed files (${allFiles.length}):`);
    // Cap at 50 files to avoid token blow-up
    const shown = allFiles.slice(0, 50);
    for (const file of shown) {
      const stat = `+${file.additions} -${file.deletions}`;
      parts.push(`  ${file.status} ${file.path} (${stat})`);
    }
    if (allFiles.length > 50) {
      parts.push(`  ... and ${allFiles.length - 50} more files`);
    }
  }

  if (derived.totalAdditions > 0 || derived.totalDeletions > 0) {
    parts.push(`Total: +${derived.totalAdditions} -${derived.totalDeletions}`);
  }

  return parts.join("\n");
}
