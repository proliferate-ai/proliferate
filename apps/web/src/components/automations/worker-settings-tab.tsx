"use client";

import { ModelSelector } from "@/components/automations/model-selector";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ModelId } from "@proliferate/shared";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useDebouncedCallback } from "use-debounce";

interface WorkerSettingsTabProps {
	worker: {
		id: string;
		name: string;
		objective: string | null;
		status: string;
		modelId: string | null;
	};
	onUpdate: (fields: { name?: string; objective?: string; modelId?: string }) => void;
	onPause: () => void;
	onResume: () => void;
	onDelete: () => void;
	isUpdating: boolean;
}

export function WorkerSettingsTab({
	worker,
	onUpdate,
	onPause,
	onResume,
	onDelete,
	isUpdating,
}: WorkerSettingsTabProps) {
	const [objectiveValue, setObjectiveValue] = useState(worker.objective || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [hasPendingChanges, setHasPendingChanges] = useState(false);

	const debouncedSaveObjective = useDebouncedCallback((value: string) => {
		onUpdate({ objective: value || undefined });
		setHasPendingChanges(false);
	}, 1000);

	const handleObjectiveChange = (value: string) => {
		setObjectiveValue(value);
		setHasPendingChanges(true);
		debouncedSaveObjective(value);
	};

	return (
		<div className="flex flex-col gap-6">
			{/* Name */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Name
				</p>
				<InlineEdit
					value={worker.name}
					onSave={(name) => onUpdate({ name })}
					className="min-w-0"
					displayClassName="text-sm font-medium text-foreground hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
					inputClassName="text-sm font-medium h-auto py-1 px-2 -mx-2 max-w-md"
				/>
			</div>

			{/* Objective */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Objective
				</p>
				<div className="relative rounded-lg border border-border overflow-hidden focus-within:border-foreground focus-within:ring-[0.5px] focus-within:ring-foreground transition-all">
					<Textarea
						value={objectiveValue}
						onChange={(e) => handleObjectiveChange(e.target.value)}
						placeholder="Describe what this coworker should do..."
						className={cn(
							"w-full text-sm focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 border-none resize-none px-4 py-3 bg-transparent rounded-none min-h-0",
							"placeholder:text-muted-foreground/60",
						)}
						style={{ minHeight: "120px" }}
					/>
					<div className="flex items-center bg-muted/50 border-t border-border/50 px-4 py-2">
						<p className="text-xs text-muted-foreground">
							{hasPendingChanges || isUpdating ? "Saving..." : "Auto-saves as you type"}
						</p>
					</div>
				</div>
			</div>

			{/* Model */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Model
				</p>
				<div className="rounded-lg border border-border">
					<div className="flex items-center justify-between px-4 py-2.5">
						<span className="text-sm text-muted-foreground">Default model</span>
						<ModelSelector
							modelId={(worker.modelId || "anthropic/claude-sonnet-4-20250514") as ModelId}
							onChange={(modelId) => onUpdate({ modelId })}
							variant="outline"
							triggerClassName="h-8 border-0 bg-muted/30 hover:bg-muted"
						/>
					</div>
				</div>
			</div>

			{/* Status toggle */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Status
				</p>
				<div className="rounded-lg border border-border">
					<div className="flex items-center justify-between px-4 py-2.5">
						<span className="text-sm text-muted-foreground">
							{worker.status === "paused" ? "Coworker is paused" : "Coworker is active"}
						</span>
						<div className="flex items-center gap-2">
							<Switch
								checked={worker.status === "active"}
								onCheckedChange={(checked) => {
									if (checked) onResume();
									else onPause();
								}}
								disabled={worker.status === "degraded" || worker.status === "failed"}
							/>
							<span className="text-sm capitalize">{worker.status}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Danger zone */}
			<div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5">
				<h3 className="text-sm font-medium text-foreground mb-1">Danger zone</h3>
				<p className="text-xs text-muted-foreground mb-3">
					Permanently delete this coworker and all associated data. This action cannot be undone.
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setDeleteDialogOpen(true)}
					className="border-destructive/30 text-destructive hover:bg-destructive/10"
				>
					<Trash2 className="h-3.5 w-3.5 mr-1.5" />
					Delete coworker
				</Button>
			</div>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Coworker</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete &quot;{worker.name}&quot; and its manager session. This
							action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={onDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
