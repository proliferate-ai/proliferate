import {
	createAcpSession,
	interruptAcpSession,
	sendAcpPrompt,
	waitForAcpReady,
} from "../../../../harness/coding/sandbox-agent-v2/client";
import type { RuntimeDriverActivationInput } from "../contracts/runtime-driver";

export interface ManagerAcpState {
	serverId: string;
	status: "ready" | "prompting" | "interrupted";
}

export class ManagerRuntimeService {
	private baseUrl: string | null = null;
	private serverId: string | null = null;
	private agentSessionId: string | null = null;

	async startOrResume(input: RuntimeDriverActivationInput): Promise<ManagerAcpState> {
		const baseUrl = input.live.previewUrl;
		if (!baseUrl) {
			throw new Error("Manager runtime requires a sandbox preview URL");
		}

		this.baseUrl = baseUrl;
		const serverId = crypto.randomUUID();
		this.serverId = serverId;

		await waitForAcpReady(baseUrl);
		const agentSessionId = await createAcpSession(baseUrl, serverId, "pi");
		this.agentSessionId = agentSessionId;
		return { serverId, status: "ready" };
	}

	async wake(prompt: string): Promise<void> {
		if (!this.baseUrl || !this.serverId) {
			throw new Error("Manager runtime has not been configured");
		}
		await sendAcpPrompt(this.baseUrl, this.serverId, prompt, this.agentSessionId ?? undefined);
	}

	async interrupt(): Promise<void> {
		if (!this.baseUrl || !this.serverId) {
			return;
		}
		await interruptAcpSession(this.baseUrl, this.serverId);
	}

	getServerId(): string | null {
		return this.serverId;
	}
}
