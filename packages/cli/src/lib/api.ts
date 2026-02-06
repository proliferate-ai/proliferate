import { getAuth } from "./config.ts";

export interface DeviceCodeResponse {
	userCode: string;
	deviceCode: string;
	verificationUrl: string;
	expiresIn: number;
	interval: number;
}

export interface PollResponse {
	token?: string;
	user?: { id: string; email: string; name?: string };
	org?: { id: string; name: string };
	error?: string;
}

export interface PrebuildResponse {
	id: string;
	snapshot_id: string;
	user_id: string;
	local_path_hash: string;
	created_at: string;
	sandbox_provider: string;
}

export interface GitHubConnectResponse {
	connectUrl: string;
	endUserId: string;
}

export interface GitHubConnectStatusResponse {
	connected: boolean;
	connectionId?: string;
	username?: string;
	error?: string;
}

export interface LocalRepoResponse {
	repo: {
		id: string;
		localPathHash: string;
		displayName: string;
	} | null;
	connection: {
		id: string;
		integrationId: string;
		integration: {
			id: string;
			integration_id: string;
			display_name: string | null;
			status: string;
		};
	} | null;
}

export interface CreateLocalRepoResponse {
	success: boolean;
	repoId: string;
	integrationId: string | null;
}

export interface CreateCliSessionResponse {
	sessionId: string;
	prebuildId: string;
	gatewayUrl: string;
	hasSnapshot: boolean;
}

export class UnauthorizedError extends Error {
	constructor(message = "Unauthorized") {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class ApiClient {
	constructor(private baseUrl: string) {}

	private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
		const auth = getAuth();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(options.headers as Record<string, string>),
		};

		if (auth?.token) {
			headers.Authorization = `Bearer ${auth.token}`;
		}

		// Pass org ID so backend knows which org context to use
		if (auth?.org?.id) {
			headers["X-Org-Id"] = auth.org.id;
		}

		const response = await fetch(`${this.baseUrl}${path}`, {
			...options,
			headers,
		});

		const data = (await response.json()) as T & { error?: string };

		if (!response.ok) {
			// Throw specific error for 401 so callers can trigger re-login
			if (response.status === 401) {
				throw new UnauthorizedError(data.error || "Unauthorized");
			}
			throw new Error(data.error || `Request failed: ${response.status}`);
		}

		return data;
	}

	// Device flow authentication
	async createDeviceCode(): Promise<DeviceCodeResponse> {
		return this.fetch<DeviceCodeResponse>("/api/cli/auth/device", {
			method: "POST",
		});
	}

	async pollDeviceCode(deviceCode: string): Promise<PollResponse> {
		const response = await fetch(`${this.baseUrl}/api/cli/auth/device/poll`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ deviceCode }),
		});
		return response.json() as Promise<PollResponse>;
	}

	// SSH keys
	async uploadSSHKey(publicKey: string, fingerprint: string, name?: string): Promise<void> {
		await this.fetch("/api/cli/ssh-keys", {
			method: "POST",
			body: JSON.stringify({ publicKey, fingerprint, name }),
		});
	}

	// GitHub OAuth
	async startGitHubConnect(): Promise<GitHubConnectResponse> {
		return this.fetch<GitHubConnectResponse>("/api/cli/github/connect", {
			method: "POST",
		});
	}

	async getGitHubConnectStatus(): Promise<GitHubConnectStatusResponse> {
		return this.fetch<GitHubConnectStatusResponse>("/api/cli/github/connect/status");
	}

	// Prebuilds (snapshot cache)
	async getPrebuild(localPathHash: string): Promise<{ prebuild: PrebuildResponse | null }> {
		return this.fetch(`/api/cli/prebuilds?localPathHash=${encodeURIComponent(localPathHash)}`);
	}

	async savePrebuild(
		localPathHash: string,
		sessionId: string,
		sandboxId: string,
	): Promise<{ prebuild: PrebuildResponse; snapshotId: string }> {
		return this.fetch("/api/cli/prebuilds", {
			method: "POST",
			body: JSON.stringify({ localPathHash, sessionId, sandboxId }),
		});
	}

	async deletePrebuild(localPathHash: string): Promise<void> {
		await this.fetch(`/api/cli/prebuilds?localPathHash=${encodeURIComponent(localPathHash)}`, {
			method: "DELETE",
		});
	}

	// GitHub
	async getGitHubStatus(): Promise<{ connected: boolean; username: string | null }> {
		return this.fetch("/api/cli/github/status");
	}

	// Local repos (directory-specific connections)
	async getLocalRepo(localPathHash: string): Promise<LocalRepoResponse> {
		return this.fetch(`/api/cli/repos?localPathHash=${encodeURIComponent(localPathHash)}`);
	}

	async createLocalRepo(
		localPathHash: string,
		displayName?: string,
		integrationId?: string,
	): Promise<CreateLocalRepoResponse> {
		return this.fetch("/api/cli/repos", {
			method: "POST",
			body: JSON.stringify({ localPathHash, displayName, integrationId }),
		});
	}

	async deleteAllLocalRepos(): Promise<{ success: boolean; deleted: number }> {
		return this.fetch("/api/cli/repos", {
			method: "DELETE",
		});
	}

	// CLI Sessions
	async createCliSession(
		localPathHash: string,
		displayName?: string,
	): Promise<CreateCliSessionResponse> {
		return this.fetch("/api/cli/sessions", {
			method: "POST",
			body: JSON.stringify({ localPathHash, displayName }),
		});
	}

	/**
	 * Get sandbox info from the gateway.
	 * This starts the sandbox if not running and returns SSH connection details.
	 */
	async getSandboxInfo(
		sessionId: string,
		gatewayUrl: string,
	): Promise<{
		sessionId: string;
		sandboxId: string | null;
		status: string;
		previewUrl: string | null;
		sshHost: string | null;
		sshPort: number | null;
		expiresAt: number | null;
	}> {
		const auth = getAuth();
		if (!auth) {
			throw new UnauthorizedError();
		}

		const url = `${gatewayUrl}/sessions/${sessionId}/sandbox`;
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${auth.token}`,
			},
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Failed to get sandbox info: ${text}`);
		}

		return response.json();
	}
}
