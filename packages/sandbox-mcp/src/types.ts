export interface ServiceInfo {
	name: string;
	command: string;
	cwd: string;
	pid: number;
	status: "running" | "stopped" | "error";
	startedAt: number;
	logFile: string;
}

export interface State {
	services: Record<string, ServiceInfo>;
	exposedPort: number | null;
}
