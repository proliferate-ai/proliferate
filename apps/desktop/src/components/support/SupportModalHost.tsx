import { useSupportModalStore } from "@/stores/support/support-modal-store";
import { SendFeedbackModal } from "./SendFeedbackModal";
import { SubmitPromptModal } from "./SubmitPromptModal";

export function SupportModalHost() {
  const open = useSupportModalStore((state) => state.open);
  const kind = useSupportModalStore((state) => state.kind);
  const close = useSupportModalStore((state) => state.close);

  if (!open) {
    return null;
  }

  if (kind === "feature") {
    return <SubmitPromptModal onClose={close} />;
  }

  return <SendFeedbackModal onClose={close} />;
}
