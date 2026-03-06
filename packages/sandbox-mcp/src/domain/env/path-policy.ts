import { isAbsolute, relative, resolve } from "node:path";
import { CliError } from "../../cli/errors.js";

export function safePath(basePath: string, untrustedPath: string): string {
	if (isAbsolute(untrustedPath)) {
		throw new CliError(`Path must be relative: ${untrustedPath}`, 2);
	}
	if (untrustedPath.split("/").includes("..")) {
		throw new CliError(`Path must not contain '..': ${untrustedPath}`, 2);
	}
	const resolvedPath = resolve(basePath, untrustedPath);
	const rel = relative(basePath, resolvedPath);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new CliError(`Path escapes workspace: ${untrustedPath}`, 2);
	}
	return resolvedPath;
}

export function resolveWorkspacePath(workspaceDir: string, workspacePath: string): string {
	if (workspacePath === "." || workspacePath === "") {
		return workspaceDir;
	}
	return safePath(workspaceDir, workspacePath);
}
