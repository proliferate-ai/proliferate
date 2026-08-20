import { cloudRootKey } from "./query-keys.js";

export function cloudHarnessLaunchOptionsKey(
  cloudSandboxId: string | null | undefined,
  harnessKind: string | null | undefined,
) {
  return [
    ...cloudRootKey(),
    "harness-launch-options",
    cloudSandboxId ?? null,
    harnessKind ?? null,
  ] as const;
}
