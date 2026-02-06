import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Get the path to the bundled opencode binary for the current platform.
 *
 * Binaries are expected at:
 * - packages/cli/bin/opencode-darwin-arm64
 * - packages/cli/bin/opencode-darwin-x64
 * - packages/cli/bin/opencode-linux-arm64
 * - packages/cli/bin/opencode-linux-x64
 */
export function getOpenCodeBinaryPath(): string {
	const platform = process.platform === "darwin" ? "darwin" : "linux";
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	const binaryName = `opencode-${platform}-${arch}`;

	// Try relative to this file first (development)
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const devPath = join(__dirname, "..", "..", "bin", binaryName);
	if (existsSync(devPath)) {
		return devPath;
	}

	// Try relative to the CLI binary (installed via npm/curl)
	const installedPath = join(dirname(process.execPath), "bin", binaryName);
	if (existsSync(installedPath)) {
		return installedPath;
	}

	// Try in the same directory as the CLI binary
	const sameDirPath = join(dirname(process.execPath), binaryName);
	if (existsSync(sameDirPath)) {
		return sameDirPath;
	}

	throw new Error(
		`OpenCode binary not found. Tried:\n  - ${devPath}\n  - ${installedPath}\n  - ${sameDirPath}\nPlease reinstall proliferate or ensure opencode binary is available.`,
	);
}
