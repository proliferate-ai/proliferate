export type ToolCategory = "lookup" | "write" | "shell" | "meta" | "system";

export const TOOL_CATEGORY: Record<string, ToolCategory> = {
	read: "lookup",
	grep: "lookup",
	glob: "lookup",
	webfetch: "lookup",

	edit: "write",
	write: "write",

	bash: "shell",

	todowrite: "meta",
	task: "meta",
	spawn_child_task: "meta",

	verify: "system",
	save_snapshot: "system",
	save_service_commands: "system",
	"automation.complete": "system",
	automation_complete: "system",
};

export const TOOL_DISPLAY_LABEL: Record<string, string> = {
	read: "Read file",
	grep: "Search",
	glob: "Find files",
	webfetch: "Fetch URL",

	edit: "Editing File",
	write: "Creating File",

	bash: "Terminal",

	todowrite: "Updated plan",
	task: "Spawned task",
	spawn_child_task: "Spawned session",

	verify: "Verification",
	save_snapshot: "Saved snapshot",
	save_service_commands: "Saved commands",
	"automation.complete": "Task complete",
	automation_complete: "Task complete",
};

export const LOOKUP_GROUP_LABEL = "Reading";

export function getToolCategory(toolName: string): ToolCategory {
	return TOOL_CATEGORY[toolName] ?? "meta";
}

export function getToolLabel(toolName: string): string {
	return TOOL_DISPLAY_LABEL[toolName] ?? toolName;
}

export function getFilePath(args: Record<string, unknown>): string | null {
	return (args.filePath as string) ?? (args.file_path as string) ?? (args.path as string) ?? null;
}

export function getFileName(path: string): string {
	return path.split("/").pop() ?? path;
}
