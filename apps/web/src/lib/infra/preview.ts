interface HttpService {
	port: number;
	process?: string | null;
	pid?: number | null;
	type: "http";
	url: string;
}

interface TcpService {
	port: number;
	process?: string | null;
	pid?: number | null;
	type: "tcp";
}

interface TerminalEntry {
	socket: string;
	session: string;
	window: string;
	pane: string;
	pane_id?: string | null;
	pane_pid?: number | null;
	pane_tty?: string | null;
	command?: string | null;
	title?: string | null;
	active?: boolean;
	window_name?: string | null;
	target?: string | null;
}

export interface ServicesResponse {
	services: HttpService[];
	tcp: TcpService[];
	terminals: TerminalEntry[];
	tmux?: { sockets: string[] };
}

export type { HttpService, TcpService, TerminalEntry };

/** Fetch sandbox service discovery data from the gateway proxy. */
export async function fetchPreviewServices(
	gatewayUrl: string,
	signal?: AbortSignal,
): Promise<ServicesResponse> {
	const res = await fetch(`${gatewayUrl}/api/services`, { signal });
	if (!res.ok) throw new Error(`Failed: ${res.status}`);
	return (await res.json()) as ServicesResponse;
}
