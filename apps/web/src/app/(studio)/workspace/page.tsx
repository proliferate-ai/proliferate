"use client";

export const dynamic = "force-dynamic";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDashboardStore } from "@/stores/dashboard";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Workspace empty state — Raycast-style centered command palette.
 * Sends the prompt and navigates to a new session.
 * Full refinement is PR 5.
 */
export default function WorkspacePage() {
	const router = useRouter();
	const { setPendingPrompt } = useDashboardStore();
	const [prompt, setPrompt] = useState("");

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = prompt.trim();
		if (!trimmed) return;
		setPendingPrompt(trimmed);
		// Navigate to sessions/new which handles session creation
		router.push("/dashboard/sessions/new");
	};

	return (
		<div className="h-full flex items-center justify-center p-4">
			<div className="w-full max-w-xl space-y-4">
				<div className="text-center space-y-1">
					<h1 className="text-lg font-medium text-foreground">What do you want to build?</h1>
					<p className="text-sm text-muted-foreground">
						Describe your task and an agent will start working on it.
					</p>
				</div>
				<form onSubmit={handleSubmit} className="flex gap-2">
					<Input
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="Fix the broken layout in src/components/..."
						className="flex-1 h-11 text-sm bg-muted/30 border-border"
						autoFocus
					/>
					<Button
						type="submit"
						size="icon"
						className="h-11 w-11 shrink-0"
						disabled={!prompt.trim()}
					>
						<ArrowRight className="h-4 w-4" />
					</Button>
				</form>
			</div>
		</div>
	);
}
