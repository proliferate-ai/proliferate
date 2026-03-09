import {
	AutomationCompleteToolUI,
	AutomationCompleteToolUIAlias,
} from "./automation-complete-tool";
import { FileEditToolUI } from "./file-edit-tool";
import { GlobToolUI } from "./glob-tool";
import { GrepToolUI } from "./grep-tool";
import { ReadFileToolUI } from "./read-file-tool";
import { SaveServiceCommandsToolUI } from "./save-service-commands-tool";
import { SaveSnapshotToolUI } from "./save-snapshot-tool";
import { ShellToolUI } from "./shell-tool";
import { SpawnChildToolUI } from "./spawn-child-tool";
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
	{ id: "save_snapshot", Component: SaveSnapshotToolUI },
	{ id: "automation.complete", Component: AutomationCompleteToolUI },
	{ id: "automation_complete", Component: AutomationCompleteToolUIAlias },
	{ id: "save_service_commands", Component: SaveServiceCommandsToolUI },
	{ id: "spawn_child_task", Component: SpawnChildToolUI },
];
