/**
 * Build a redirect URL for the workspace session page, preserving orgId and optional runId.
 */
export function buildWorkspaceRedirectUrl(
	sessionId: string,
	orgId: string,
	runId?: string | null,
): string {
	const params = new URLSearchParams({ orgId });
	if (runId) params.set("runId", runId);
	return `/workspace/${sessionId}?${params.toString()}`;
}

/**
 * Build a redirect URL for the preview session page, preserving orgId.
 */
export function buildPreviewRedirectUrl(sessionId: string, orgId: string): string {
	const params = new URLSearchParams({ orgId });
	return `/preview/${sessionId}?${params.toString()}`;
}
