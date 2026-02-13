import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// CLI version - read from package.json (bumped by changesets)
// Uses import.meta.dirname which works in both dev and compiled binaries
// Compiled binaries use --include=package.json to embed it in the virtual filesystem
function getVersion(): string {
	try {
		// path.resolve normalizes the path (required for Deno's embedded filesystem)
		const pkgPath = resolve(import.meta.dirname, "..", "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
		return pkg.version;
	} catch {
		return "0.0.0";
	}
}

export const CLI_VERSION = getVersion();

// Cloud defaults keep the released CLI usable without local env wiring.
const DEFAULT_API_URL = "https://app.proliferate.com";
const resolvedApiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
const resolvedGatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? `${resolvedApiUrl}/gateway`;

// Gateway URL for session creation and OpenCode attach.
export const GATEWAY_URL = resolvedGatewayUrl;

// GitHub repository for releases (public repo)
export const GITHUB_REPO = "proliferate-ai/cli";
export const GITHUB_REPO_FALLBACK = "proliferate-ai/cli";

// Install script URL
export const INSTALL_SCRIPT_URL =
	"https://raw.githubusercontent.com/proliferate-ai/cli/main/install.sh";
