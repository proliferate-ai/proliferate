import { SANDBOX_PATHS, shellEscape } from "../../sandbox";

export const CLEAR_STALE_PROCESSES_COMMAND =
	"fuser -k 4096/tcp 4000/tcp 8470/tcp 2>/dev/null || true; pkill -9 caddy || true; sleep 0.5";

export const FIND_GIT_DIR_FALLBACK_COMMAND =
	"find /home/user -maxdepth 5 -name '.git' -type d 2>/dev/null | head -1";

export const FIND_WORKSPACE_REPO_FALLBACK_COMMAND =
	"ls -d /home/user/workspace/*/repo 2>/dev/null | head -1";

export function buildCloneCommand(branch: string, cloneUrl: string, targetDir: string): string {
	return `git clone --depth 1 --branch ${shellEscape(branch)} '${cloneUrl}' ${shellEscape(targetDir)}`;
}

export function buildCloneDefaultBranchCommand(cloneUrl: string, targetDir: string): string {
	return `git clone --depth 1 '${cloneUrl}' ${shellEscape(targetDir)}`;
}

export function buildEnvExportCommand(): string {
	return `for key in $(jq -r 'keys[]' ${SANDBOX_PATHS.envProfileFile}); do export "$key=$(jq -r --arg k "$key" '.[$k]' ${SANDBOX_PATHS.envProfileFile})"; done`;
}
