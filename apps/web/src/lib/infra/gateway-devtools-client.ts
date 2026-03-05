import { GATEWAY_URL } from "@/lib/infra/gateway";
import { HttpError, parseJsonResponse } from "@/lib/infra/http";

export interface ServiceInfo {
	name: string;
	command: string;
	cwd: string;
	pid: number;
	status: "running" | "stopped" | "error";
	startedAt: number;
	logFile: string;
}

export interface ServiceListData {
	services: ServiceInfo[];
	exposedPort: number | null;
}

export interface GitRepo {
	id: string;
	path: string;
}

export interface GitFileStatus {
	status: string;
	path: string;
}

export interface GitStatusResponse {
	branch: string;
	ahead: number;
	behind: number;
	files: GitFileStatus[];
}

export function buildGatewayProxyUrl(sessionId: string, token: string, path: string): string {
	return `${GATEWAY_URL}/proxy/${sessionId}/${token}${path}`;
}

export function buildDevtoolsMcpUrl(sessionId: string, token: string, path: string): string {
	return buildGatewayProxyUrl(sessionId, token, `/devtools/mcp${path}`);
}

export async function listServices(sessionId: string, token: string): Promise<ServiceListData> {
	const response = await fetch(buildDevtoolsMcpUrl(sessionId, token, "/api/services"));
	return parseJsonResponse<ServiceListData>(response);
}

export async function stopService(sessionId: string, token: string, name: string): Promise<void> {
	const response = await fetch(
		buildDevtoolsMcpUrl(sessionId, token, `/api/services/${encodeURIComponent(name)}`),
		{
			method: "DELETE",
		},
	);
	await parseJsonResponse<unknown>(response);
}

export async function startService(
	sessionId: string,
	token: string,
	input: { name: string; command: string; cwd?: string },
): Promise<void> {
	const response = await fetch(buildDevtoolsMcpUrl(sessionId, token, "/api/services"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	await parseJsonResponse<unknown>(response);
}

export async function startServiceAllowConflict(
	sessionId: string,
	token: string,
	input: { name: string; command: string; cwd?: string },
): Promise<void> {
	try {
		await startService(sessionId, token, input);
	} catch (error) {
		if (error instanceof HttpError && error.status === 409) {
			return;
		}
		throw error;
	}
}

export async function exposePort(sessionId: string, token: string, port: number): Promise<void> {
	const response = await fetch(buildDevtoolsMcpUrl(sessionId, token, "/api/expose"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ port }),
	});
	await parseJsonResponse<unknown>(response);
}

export function createServiceLogsEventSource(
	sessionId: string,
	token: string,
	serviceName: string,
): EventSource {
	return new EventSource(
		buildDevtoolsMcpUrl(sessionId, token, `/api/logs/${encodeURIComponent(serviceName)}`),
	);
}

export async function listGitRepos(
	sessionId: string,
	token: string,
): Promise<{ repos: GitRepo[] }> {
	const response = await fetch(buildDevtoolsMcpUrl(sessionId, token, "/api/git/repos"));
	return parseJsonResponse<{ repos: GitRepo[] }>(response);
}

export async function getGitStatus(
	sessionId: string,
	token: string,
	repoId: string,
): Promise<GitStatusResponse> {
	const response = await fetch(
		buildDevtoolsMcpUrl(sessionId, token, `/api/git/status?repo=${encodeURIComponent(repoId)}`),
	);
	return parseJsonResponse<GitStatusResponse>(response);
}

export async function getGitDiff(
	sessionId: string,
	token: string,
	repoId: string,
	filePath?: string | null,
): Promise<{ diff: string }> {
	const params = new URLSearchParams({ repo: repoId });
	if (filePath) {
		params.set("path", filePath);
	}

	const response = await fetch(buildDevtoolsMcpUrl(sessionId, token, `/api/git/diff?${params}`));
	return parseJsonResponse<{ diff: string }>(response);
}

export async function checkPreviewHealth(
	sessionId: string,
	token: string,
	targetUrl: string,
): Promise<{ ready: boolean }> {
	const response = await fetch(
		buildGatewayProxyUrl(sessionId, token, `/health-check?url=${encodeURIComponent(targetUrl)}`),
	);
	return parseJsonResponse<{ ready: boolean }>(response);
}
