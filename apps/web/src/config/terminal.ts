export type ConnectionStatus = "connecting" | "connected" | "error" | "closed";

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
	connecting: "Connecting",
	connected: "Connected",
	error: "Error",
	closed: "Disconnected",
};
