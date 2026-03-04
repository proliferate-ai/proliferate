import { URL } from "node:url";

export function rewriteVscodeProxyPath(path: string): string {
	return `/_proliferate/vscode${path || "/"}`;
}

export function rewriteVscodeRedirectLocation(location: string): string {
	if (!/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(location)) {
		return location;
	}

	try {
		const parsed = new URL(location);
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return location;
	}
}
