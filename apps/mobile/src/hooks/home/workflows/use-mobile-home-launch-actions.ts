import { useRef, useState } from "react";
import type {
  CloudHarnessLaunchOptionsResponse,
} from "@proliferate/product-client/internal/domain/chats/cloud/launch-options-model";
import type { CloudLaunchComposerSelection } from "@proliferate/product-client/internal/domain/chats/cloud/composer-controls";

import {
  buildBranchName,
  buildMobilePendingPrompt,
  buildWorkspaceDisplayName,
  type MobileRepoOption,
  type MobileRuntimeOption,
} from "../../../lib/domain/home/mobile-home-launch";
import { savePendingMobilePrompt } from "../../../lib/access/cloud/pending-mobile-prompt-store";
import type { MobileCloudChat } from "../../../navigation/navigation-model";

export function useMobileHomeLaunchActions(input: {
  ownerUserId: string | null;
  launchOptions?: CloudHarnessLaunchOptionsResponse | null;
  selectedRepo: MobileRepoOption | null;
  selectedBaseBranch: string | null;
  selectedRuntime: MobileRuntimeOption | null;
  selection: CloudLaunchComposerSelection;
  onOpenChat: (chat: MobileCloudChat) => void;
  onSubmitted?: () => void;
  /**
   * Readiness gate (PR 7): when the managed-Cloud / GitHub App prerequisites
   * for the selected repo are not met, submit is blocked with this reason.
   * Passed as a plain string so this workflow stays free of access hooks.
   */
  readinessBlockedReason?: string | null;
}) {
  const submitInFlightRef = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The cloud workspace stack is deleted: mobile has no launch target left,
  // so submit refuses with an honest error instead of creating anything.
  async function submit(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt || !input.selectedRepo || !input.selectedRuntime || submitInFlightRef.current) {
      return;
    }
    setStatus(null);
    setError("Cloud workspaces are no longer available.");
  }

  return {
    error,
    status,
    submit,
    submitting: submitInFlightRef.current,
  };
}
