"use client";

import { Button } from "@/components/ui/button";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { Check, ChevronDown, ChevronRight, Circle, Loader2 } from "lucide-react";
import { useState } from "react";
import { ProliferateToolCard } from "./proliferate-tool-card";

type TodoItem = {
	id?: string;
	content: string;
	status: "pending" | "in_progress" | "completed";
	priority?: string;
	activeForm?: string;
};

type TodoWriteArgs = {
	todos?: TodoItem[];
};

export const TodoWriteToolUI = makeAssistantToolUI<TodoWriteArgs, string>({
	toolName: "todowrite",
	render: function TodoWriteUI({ args, status }) {
		const [isExpanded, setIsExpanded] = useState(true);
		const isRunning = status.type === "running";
		const todos = args.todos || [];

		const completedCount = todos.filter((t) => t.status === "completed").length;
		const totalCount = todos.length;

		// Initial loading state - no todos yet
		if (isRunning && totalCount === 0) {
			return (
				<ProliferateToolCard label="Todo plan" status="running">
					Planning tasks...
				</ProliferateToolCard>
			);
		}

		return (
			<ProliferateToolCard label="Todo plan" status={isRunning ? "running" : "success"}>
				<Button
					variant="ghost"
					onClick={() => setIsExpanded(!isExpanded)}
					className="flex w-full h-auto items-center justify-start gap-2 px-0 py-0 text-xs text-muted-foreground hover:bg-transparent rounded-none"
				>
					{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
					<span>
						{completedCount} of {totalCount} Done
					</span>
					{isRunning && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
				</Button>

				{isExpanded && todos.length > 0 && (
					<div className="pt-2 space-y-1">
						{todos.map((todo, index) => (
							<TodoItemRow key={todo.id || index} todo={todo} />
						))}
					</div>
				)}
			</ProliferateToolCard>
		);
	},
});

function TodoItemRow({ todo }: { todo: TodoItem }) {
	return (
		<div className="flex items-center gap-2 py-0.5">
			<TodoStatusIcon status={todo.status} />
			<span
				className={`text-sm ${
					todo.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"
				}`}
			>
				{todo.content}
			</span>
		</div>
	);
}

function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
	switch (status) {
		case "completed":
			return (
				<div className="h-4 w-4 rounded-full bg-muted-foreground/20 flex items-center justify-center">
					<Check className="h-3 w-3 text-muted-foreground" />
				</div>
			);
		case "in_progress":
			return (
				<div className="h-4 w-4 rounded-full border-2 border-info flex items-center justify-center">
					<div className="h-1.5 w-1.5 rounded-full bg-info" />
				</div>
			);
		default:
			return <Circle className="h-4 w-4 text-muted-foreground/50" />;
	}
}
