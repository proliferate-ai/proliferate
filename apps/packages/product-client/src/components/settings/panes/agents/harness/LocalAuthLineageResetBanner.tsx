import { Button } from "#product/primitives/Button";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { useResetLocalAgentAuth } from "#product/hooks/access/anyharness/agent-auth/use-reset-local-agent-auth";
import { useLocalAuthDeliveryStore } from "#product/stores/agents/local-auth-delivery-store";

/** The runtime's typed code for a foreign counter lineage (`RouteAuthError::code`). */
export const AGENT_ROUTE_STATE_LINEAGE = "AGENT_ROUTE_STATE_LINEAGE";

/**
 * Shown when the runtime's last words are unavailable (the failure was
 * recorded without a detail). Mirrors the runtime's own Display copy so the
 * user reads the same sentence either way — the runtime's words are the
 * authority and are preferred verbatim when present.
 */
const LINEAGE_REFUSAL_FALLBACK =
  "this machine holds agent-auth state from a different server database. "
  + "If the server was rebuilt or switched on purpose, reset this machine's "
  + "agent auth (Settings → Agents) and it will adopt the new one.";

const RESET_ACTION_LABEL = "Reset this machine's agent auth";

/**
 * The foreign-lineage recovery affordance (founder-ruled, minimal): when the
 * courier's last push was refused with `AGENT_ROUTE_STATE_LINEAGE` — the
 * server's counter was reborn (DB rebuild / server switch) and this machine
 * still holds the retired lineage's state — the pane shows the runtime's
 * plain-words refusal and the ONE recovery action: reset this machine's
 * agent auth (the existing state DELETE), after which the re-triggered sync
 * adopts the new lineage. Renders nothing in every other state; retrying
 * without the reset can never succeed, which is why this is a banner with an
 * action rather than another pending spinner.
 */
export function LocalAuthLineageResetBanner() {
  const lastPushFailure = useLocalAuthDeliveryStore((state) => state.lastPushFailure);

  if (lastPushFailure?.code !== AGENT_ROUTE_STATE_LINEAGE) {
    return null;
  }

  return <LineageResetNotice detail={lastPushFailure.detail} />;
}

/**
 * Split below the visibility gate so the reset hook (and its QueryClient
 * dependency) only mounts when there is actually a refusal to recover from —
 * the pane's ordinary render touches no query machinery for a banner that
 * renders nothing.
 */
function LineageResetNotice({ detail }: { detail: string | null }) {
  const { reset, resetting } = useResetLocalAgentAuth();

  return (
    <NoticeBanner
      tone="warning"
      data-local-auth-lineage-banner=""
      action={(
        <Button
          variant="outline"
          size="sm"
          disabled={resetting}
          onClick={() => {
            void reset();
          }}
        >
          {RESET_ACTION_LABEL}
        </Button>
      )}
    >
      {detail ?? LINEAGE_REFUSAL_FALLBACK}
    </NoticeBanner>
  );
}
