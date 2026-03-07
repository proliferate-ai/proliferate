import type { ManagerControlFacade } from "../control-facade";

export interface ManagerToolContext {
	managerSessionId: string;
	organizationId: string;
	workerId: string;
	workerRunId: string;
	gatewayUrl: string;
	serviceToken: string;
	controlFacade?: ManagerControlFacade;
}
