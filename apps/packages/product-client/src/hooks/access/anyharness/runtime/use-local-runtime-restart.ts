import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { restartHarnessRuntime } from "#product/lib/access/anyharness/runtime-bootstrap";

/**
 * Restart the local AnyHarness runtime, or null on a host that has none.
 *
 * One value carries both facts a caller needs, because they are the same fact:
 * the desktop runtime bridge either exists — in which case a restart is a
 * control that genuinely works — or it does not, in which case there is no
 * local runtime to connect to at all and no surface should imply otherwise
 * (E-R33/E-R34). `restartHarnessRuntime` was already exported and tested with
 * no production caller; this is the seam that gives it one, following the
 * `useProductHost().desktop?.runtime` pattern `useSupportSnapshotBinding`
 * already uses rather than adding an abstraction beside it.
 */
export function useLocalRuntimeRestart(): (() => void) | null {
  const runtime = useProductHost().desktop?.runtime ?? null;
  const restart = useCallback(() => {
    if (!runtime) {
      return;
    }
    void restartHarnessRuntime(runtime);
  }, [runtime]);
  return runtime ? restart : null;
}
