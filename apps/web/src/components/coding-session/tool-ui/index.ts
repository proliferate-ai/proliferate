export { ReadFileToolUI } from "./read-file-tool";
export { ShellToolUI } from "./shell-tool";
export { FileEditToolUI } from "./file-edit-tool";
export { WriteFileToolUI } from "./write-file-tool";
export { GlobToolUI } from "./glob-tool";
export { GrepToolUI } from "./grep-tool";
export { TodoWriteToolUI } from "./todo-write-tool";
export { TaskToolUI } from "./task-tool";
export { WebFetchToolUI } from "./web-fetch-tool";
export { VerificationToolUI } from "./verification-tool";
export { EnvRequestToolUI, SessionContext } from "./env-request-tool";
export { SaveSnapshotToolUI } from "./save-snapshot-tool";
export {
	AutomationCompleteToolUI,
	AutomationCompleteToolUIAlias,
} from "./automation-complete-tool";
export { SaveServiceCommandsToolUI } from "./save-service-commands-tool";
export { SaveEnvFilesToolUI } from "./save-env-files-tool";

import {
	AutomationCompleteToolUI,
	AutomationCompleteToolUIAlias,
} from "./automation-complete-tool";
import { EnvRequestToolUI } from "./env-request-tool";
import { FileEditToolUI } from "./file-edit-tool";
import { GlobToolUI } from "./glob-tool";
import { GrepToolUI } from "./grep-tool";
import { ReadFileToolUI } from "./read-file-tool";
import { SaveEnvFilesToolUI } from "./save-env-files-tool";
import { SaveServiceCommandsToolUI } from "./save-service-commands-tool";
import { SaveSnapshotToolUI } from "./save-snapshot-tool";
import { ShellToolUI } from "./shell-tool";
import { TaskToolUI } from "./task-tool";
import { TodoWriteToolUI } from "./todo-write-tool";
import { VerificationToolUI } from "./verification-tool";
import { WebFetchToolUI } from "./web-fetch-tool";
import { WriteFileToolUI } from "./write-file-tool";

export const allToolUIs = [
	{ id: "read", Component: ReadFileToolUI },
	{ id: "bash", Component: ShellToolUI },
	{ id: "edit", Component: FileEditToolUI },
	{ id: "write", Component: WriteFileToolUI },
	{ id: "glob", Component: GlobToolUI },
	{ id: "grep", Component: GrepToolUI },
	{ id: "todowrite", Component: TodoWriteToolUI },
	{ id: "task", Component: TaskToolUI },
	{ id: "webfetch", Component: WebFetchToolUI },
	{ id: "verify", Component: VerificationToolUI },
	{ id: "request_env_variables", Component: EnvRequestToolUI },
	{ id: "save_snapshot", Component: SaveSnapshotToolUI },
	{ id: "automation.complete", Component: AutomationCompleteToolUI },
	{ id: "automation_complete", Component: AutomationCompleteToolUIAlias },
	{ id: "save_service_commands", Component: SaveServiceCommandsToolUI },
	{ id: "save_env_files", Component: SaveEnvFilesToolUI },
];
