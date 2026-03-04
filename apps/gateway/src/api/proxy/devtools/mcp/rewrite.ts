export function rewriteDevtoolsMcpPath(path: string): string {
	return `/_proliferate/mcp${path || "/"}`;
}
