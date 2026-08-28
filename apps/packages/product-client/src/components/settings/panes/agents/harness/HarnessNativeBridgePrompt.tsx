import { Button } from "#product/primitives/Button";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { NATIVE_BRIDGE_COPY } from "#product/copy/settings/native-bridge-copy";
import { useNativeBridge } from "#product/hooks/access/anyharness/agents/use-native-bridge";

/**
 * The native-migration bridge's one-time settings prompt (agent_auth spec,
 * zero-rows cutover row): shown while this harness still holds the legacy
 * flag that keeps its launches on the harness's own login. Acting clears the
 * flag — either by configuring a method in the Authentication section below
 * (the applied document then names the harness and the runtime drops the
 * flag itself) or by the explicit dismiss here.
 *
 * PLACEHOLDER UX — every string and the banner layout are flagged for the
 * design pass (delivery-spec-slice-6-cleanups: "functional placeholder UX,
 * every string flagged"). Local surface only: the bridge is machine truth.
 */
export function HarnessNativeBridgePrompt({
  harnessKind,
  displayName,
}: {
  harnessKind: string;
  displayName: string;
}) {
  const bridge = useNativeBridge(harnessKind, true);
  if (!bridge.pending) return null;

  return (
    <NoticeBanner
      tone="info"
      className="flex-col items-stretch gap-3 sm:flex-row sm:items-center"
      data-native-bridge-prompt={harnessKind}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-ui font-medium text-foreground">
          {NATIVE_BRIDGE_COPY.title(displayName)}
        </p>
        <p className="text-ui-sm text-muted-foreground">
          {NATIVE_BRIDGE_COPY.body(displayName)}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="sm"
          disabled={bridge.dismiss.isPending}
          onClick={() => {
            bridge.dismiss.mutate();
          }}
        >
          {NATIVE_BRIDGE_COPY.dismiss}
        </Button>
      </div>
    </NoticeBanner>
  );
}
