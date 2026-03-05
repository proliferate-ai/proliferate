import { GATEWAY_URL } from "@/lib/infra/gateway";
import { parseJsonResponse } from "@/lib/infra/http";
import type { FsTreeEntry, PreviewPort } from "@proliferate/shared/contracts/harness";

export interface DaemonHealthResponse {
	ok: boolean;
	uptime?: number;
}

export interface PreviewPortsResponse {
	ports: PreviewPort[];
}

export interface FileReadResponse {
	content: string;
	size: number;
}

export interface FileReadBinaryResponse {
	base64: string;
	size: number;
	mimeType: string;
}

export interface FileWriteResponse {
	bytesWritten: number;
}

export interface FsTreeResponse {
	entries: FsTreeEntry[];
}

function withBearer(token: string): HeadersInit {
	return { Authorization: `Bearer ${token}` };
}

function harnessUrl(sessionId: string, path: string): string {
	return `${GATEWAY_URL}/proliferate/v1/sessions/${sessionId}${path}`;
}

export async function getDaemonHealth(
	sessionId: string,
	token: string,
): Promise<DaemonHealthResponse> {
	const response = await fetch(harnessUrl(sessionId, "/daemon/health"), {
		headers: withBearer(token),
	});
	return parseJsonResponse<DaemonHealthResponse>(response);
}

export async function getPreviewPorts(
	sessionId: string,
	token: string,
): Promise<PreviewPortsResponse> {
	const response = await fetch(harnessUrl(sessionId, "/preview/ports"), {
		headers: withBearer(token),
	});
	return parseJsonResponse<PreviewPortsResponse>(response);
}

export async function getFsTree(
	sessionId: string,
	token: string,
	path: string,
	depth: number,
): Promise<FsTreeResponse> {
	const response = await fetch(
		harnessUrl(sessionId, `/fs/tree?path=${encodeURIComponent(path)}&depth=${depth}`),
		{
			headers: withBearer(token),
		},
	);
	return parseJsonResponse<FsTreeResponse>(response);
}

export async function readFsFile(
	sessionId: string,
	token: string,
	path: string,
): Promise<FileReadResponse> {
	const response = await fetch(harnessUrl(sessionId, `/fs/read?path=${encodeURIComponent(path)}`), {
		headers: withBearer(token),
	});
	return parseJsonResponse<FileReadResponse>(response);
}

export async function readFsFileBinary(
	sessionId: string,
	token: string,
	path: string,
): Promise<FileReadBinaryResponse> {
	const response = await fetch(
		harnessUrl(sessionId, `/fs/read?path=${encodeURIComponent(path)}&format=base64`),
		{
			headers: withBearer(token),
		},
	);
	return parseJsonResponse<FileReadBinaryResponse>(response);
}

export async function writeFsFile(
	sessionId: string,
	token: string,
	path: string,
	content: string,
): Promise<FileWriteResponse> {
	const response = await fetch(harnessUrl(sessionId, "/fs/write"), {
		method: "POST",
		headers: {
			...withBearer(token),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ path, content }),
	});
	return parseJsonResponse<FileWriteResponse>(response);
}
