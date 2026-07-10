import { useEffect } from "react";
import { useSupportModalStore } from "@/stores/support/support-modal-store";
import { useSupportAvailability } from "@/hooks/support/facade/use-support-availability";
import { SendFeedbackModal } from "./SendFeedbackModal";
import { SubmitPromptModal } from "./SubmitPromptModal";

export function SupportModalHost() {
  const open = useSupportModalStore((state) => state.open);
  const kind = useSupportModalStore((state) => state.kind);
  const close = useSupportModalStore((state) => state.close);
  const { canSubmit } = useSupportAvailability();

  // Backstop for the store-level gate: if the session drops while the modal is
  // open (e.g. sign-out mid-report), close it rather than leave a report being
  // composed that can't be sent.
  useEffect(() => {
    if (open && !canSubmit) {
      close();
    }
  }, [open, canSubmit, close]);

  if (!open || !canSubmit) {
    return null;
  }

  if (kind === "feature") {
    return <SubmitPromptModal onClose={close} />;
  }

  return <SendFeedbackModal onClose={close} />;
}
