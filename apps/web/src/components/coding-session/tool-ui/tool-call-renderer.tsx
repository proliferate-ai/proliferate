"use client";

import type { ToolCategory } from "@/config/tool-ui";
import { getToolCategory } from "@/lib/sessions/tool-utils";
import { EditDisplay } from "./displays/edit-display";
import { MetaDisplay } from "./displays/meta-display";
import { ReadingSummary } from "./displays/reading-summary";
import { ShellDisplay } from "./displays/shell-display";
import { SystemDisplay } from "./displays/system-display";

export interface ToolCallPart {
	toolName: string;
	toolCallId?: string;
	args: Record<string, unknown>;
	result?: unknown;
	status?: { type: string };
}

interface ToolCallBlockProps {
	tools: ToolCallPart[];
}

interface GroupedBlock {
	category: ToolCategory;
	tools: ToolCallPart[];
}

function groupByCategory(tools: ToolCallPart[]): GroupedBlock[] {
	const blocks: GroupedBlock[] = [];
	for (const tool of tools) {
		const category = getToolCategory(tool.toolName);
		const last = blocks[blocks.length - 1];
		if (last?.category === category) {
			last.tools.push(tool);
		} else {
			blocks.push({ category, tools: [tool] });
		}
	}
	return blocks;
}

export function ToolCallBlock({ tools }: ToolCallBlockProps) {
	const blocks = groupByCategory(tools);

	return (
		<div className="my-1">
			{blocks.map((block, i) => {
				const key = `${block.category}-${i}`;
				switch (block.category) {
					case "lookup":
						return (
							<ReadingSummary
								key={key}
								tools={block.tools}
								hasRunning={block.tools.some((t) => t.status?.type === "running")}
							/>
						);
					case "write":
						return block.tools.map((tool) => (
							<EditDisplay
								key={tool.toolCallId ?? `write-${i}`}
								toolName={tool.toolName}
								args={tool.args}
								result={tool.result}
								status={tool.status}
							/>
						));
					case "shell":
						return block.tools.map((tool) => (
							<ShellDisplay
								key={tool.toolCallId ?? `shell-${i}`}
								args={tool.args}
								result={tool.result}
								status={tool.status}
							/>
						));
					case "meta":
						return block.tools.map((tool) => (
							<MetaDisplay
								key={tool.toolCallId ?? `meta-${i}`}
								toolName={tool.toolName}
								args={tool.args}
								status={tool.status}
							/>
						));
					case "system":
						return block.tools.map((tool) => (
							<SystemDisplay
								key={tool.toolCallId ?? `sys-${i}`}
								toolName={tool.toolName}
								status={tool.status}
							/>
						));
					default:
						return null;
				}
			})}
		</div>
	);
}
