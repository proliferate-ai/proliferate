import { Button } from "@proliferate/ui/primitives/Button";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import { useDelegatedAgentVisualAssignment } from "@/hooks/chat/derived/use-delegated-agent-visual-assignment";
import { useTranscriptSessionId } from "./TranscriptContexts";

interface DelegatedAgentReceiptNameProps {
  id: string;
  title?: string | null;
  sessionId?: string | null;
  sessionLinkId?: string | null;
  onOpenSession?: (sessionId: string) => void;
  className?: string;
}

export function DelegatedAgentReceiptName({
  id,
  title,
  sessionId,
  sessionLinkId,
  onOpenSession,
  className = "",
}: DelegatedAgentReceiptNameProps) {
  const transcriptSessionId = useTranscriptSessionId();
  const visualAssignment = useDelegatedAgentVisualAssignment({
    parentSessionId: transcriptSessionId,
    sessionLinkId,
  });
  const identity = buildDelegatedAgentIdentity({
    id,
    title,
    sessionId,
    sessionLinkId,
    colorIndex: visualAssignment.colorIndex,
    shapeSalt: visualAssignment.shapeSalt,
  });
  const visibleLabel = identity.generatedName;
  const fullLabel = identity.displayName;
  const targetSessionId = sessionId?.trim() || null;
  const textClassName = `font-medium ${identity.textColorClassName} ${className}`.trim();

  if (targetSessionId && onOpenSession) {
    return (
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-chat-transcript-ignore
        aria-label={`Open ${fullLabel}`}
        title={fullLabel}
        className={`inline h-auto p-0 align-baseline leading-[inherit] hover:underline focus-visible:underline ${textClassName}`}
        onClick={() => onOpenSession(targetSessionId)}
      >
        {visibleLabel}
      </Button>
    );
  }

  return (
    <span className={textClassName} title={fullLabel}>
      {visibleLabel}
    </span>
  );
}
