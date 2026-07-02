import type {
  RuntimeConfigRevisionExpectation,
} from "@anyharness/sdk";
import type { RuntimeTarget } from "@/lib/access/anyharness/runtime-target";
import type {
  AnyHarnessRuntimeConfigConnection,
} from "@/lib/access/anyharness/runtime-config";

interface PrepareLocalSessionRuntimeConfigOptions {
  cloudPreflightTimeoutMs?: number;
}

export function assertDirectSessionCreateRuntimeConfigStamped(
  target: RuntimeTarget,
): void {
  if (target.location === "local" || target.runtimeAccessKind === "proliferate-gateway") {
    return;
  }
  throw new Error(
    "Remote session creation requires runtime config stamping. Start this session through the managed gateway or cloud command path.",
  );
}

export async function prepareLocalSessionRuntimeConfig(
  _connection: AnyHarnessRuntimeConfigConnection,
  _options?: unknown,
  _config?: PrepareLocalSessionRuntimeConfigOptions,
): Promise<RuntimeConfigRevisionExpectation | null> {
  return null;
}

export async function prepareLocalRuntimeConfigForTarget(
  target: RuntimeTarget,
  connection: AnyHarnessRuntimeConfigConnection,
  options?: unknown,
  config?: PrepareLocalSessionRuntimeConfigOptions,
): Promise<RuntimeConfigRevisionExpectation | null> {
  if (target.location !== "local" && target.runtimeAccessKind !== "proliferate-gateway") {
    return null;
  }
  return prepareLocalSessionRuntimeConfig(connection, options, config);
}
