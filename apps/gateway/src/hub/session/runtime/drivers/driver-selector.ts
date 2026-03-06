import type { RuntimeDriver } from "../contracts/runtime-driver";
import type { SessionConfig } from "../state/session-config";
import type { CodingRuntimeDriver } from "./coding-runtime-driver";
import type { ManagerRuntimeDriver } from "./manager-runtime-driver";

export function selectRuntimeDriver(
	config: SessionConfig,
	drivers: {
		coding: CodingRuntimeDriver;
		manager: ManagerRuntimeDriver;
	},
): RuntimeDriver {
	return config.kind === "manager" ? drivers.manager : drivers.coding;
}
