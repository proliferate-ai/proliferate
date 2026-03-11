import type { ToolCategory } from "@/config/tool-ui";
import { TOOL_CATEGORY, TOOL_DISPLAY_LABEL } from "@/config/tool-ui";

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
