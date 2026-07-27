import { AuthRestartModal } from "#product/components/agents/AuthRestartModal";
import { useAuthRestartOffer } from "#product/hooks/agents/workflows/use-auth-restart-offer";
import { restartSessionLabel } from "#product/lib/domain/agents/auth-restart-offer";

/**
 * Mounts the restart offer (agent-auth.md "Running sessions are offered a
 * restart", Proof C6) app-wide: the pending→applied ack can land while any
 * screen is open (the desktop sync hook acks local pushes from the lifecycle
 * root; the cloud materializer acks server-side), so the trigger lives beside
 * the other product lifecycles rather than inside the settings pane.
 */
export function AuthRestartOfferRoot() {
  const { offer, offeredSessions, restartNow, decline } = useAuthRestartOffer();
  if (offer === null) {
    return null;
  }
  return (
    <AuthRestartModal
      open
      harnessKind={offer.harnessKind}
      surface={offer.surface}
      sessions={offeredSessions.map((entry) => ({
        sessionId: entry.sessionId,
        label: restartSessionLabel(entry),
      }))}
      onRestartNow={restartNow}
      onDecline={decline}
    />
  );
}
