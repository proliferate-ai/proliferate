import { realpathSync } from "node:fs";
import path from "node:path";

export function isPathInsideWorkspace(workspaceDir: string, candidatePath: string): boolean {
	try {
		const realCandidate = realpathSync(candidatePath);
		const realWorkspace = realpathSync(workspaceDir);
		return realCandidate === realWorkspace || realCandidate.startsWith(`${realWorkspace}/`);
	} catch {
		return candidatePath === workspaceDir || candidatePath.startsWith(`${workspaceDir}/`);
	}
}

export function decodeRepoId(workspaceDir: string, repoId: string): string | null {
	try {
		const decoded = Buffer.from(repoId, "base64").toString("utf-8");
		const resolved = path.resolve(decoded);
		if (!isPathInsideWorkspace(workspaceDir, resolved)) {
			return null;
		}
		return resolved;
	} catch {
		return null;
	}
}
