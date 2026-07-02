import type { RuntimeTarget } from "@/lib/access/anyharness/runtime-target";

export function assertDirectSessionCreateSupported(
  target: RuntimeTarget,
): void {
  if (target.location === "local" || target.runtimeAccessKind === "proliferate-gateway") {
    return;
  }
  throw new Error(
    "Direct session creation is only supported on local runtimes or through the managed cloud gateway. Start this session through the managed gateway or cloud command path.",
  );
}
