import type Anthropic from "@anthropic-ai/sdk";

const SOURCE_READ_TOOL_NAMES = new Set(["read_source", "get_source_item", "list_source_bindings"]);

export function filterToolsByCapabilities(
	tools: Anthropic.Tool[],
	deniedCapabilities: Set<string>,
): Anthropic.Tool[] {
	const sourceReadKeys = ["source.sentry.read", "source.linear.read", "source.github.read"];
	const allSourceDenied = sourceReadKeys.every((key) => deniedCapabilities.has(key));

	if (!allSourceDenied) return tools;
	return tools.filter((tool) => !SOURCE_READ_TOOL_NAMES.has(tool.name));
}
