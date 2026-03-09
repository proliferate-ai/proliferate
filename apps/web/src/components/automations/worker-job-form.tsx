"use client";

import { describeCron } from "@/components/automations/worker-job-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

interface WorkerJobFormValues {
	name: string;
	checkInPrompt: string;
	cronExpression: string;
	description?: string;
	enabled?: boolean;
}

interface WorkerJobFormProps {
	initialValues?: WorkerJobFormValues;
	onSubmit: (values: WorkerJobFormValues) => void;
	onCancel: () => void;
	isSubmitting?: boolean;
}

export function WorkerJobForm({
	initialValues,
	onSubmit,
	onCancel,
	isSubmitting,
}: WorkerJobFormProps) {
	const [name, setName] = useState(initialValues?.name ?? "");
	const [checkInPrompt, setCheckInPrompt] = useState(initialValues?.checkInPrompt ?? "");
	const [cronExpression, setCronExpression] = useState(initialValues?.cronExpression ?? "");
	const [description, setDescription] = useState(initialValues?.description ?? "");
	const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);

	const cronDescription = cronExpression ? describeCron(cronExpression) : null;
	const isValid =
		name.trim().length > 0 && checkInPrompt.trim().length > 0 && cronExpression.trim().length > 0;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!isValid) return;
		onSubmit({
			name: name.trim(),
			checkInPrompt: checkInPrompt.trim(),
			cronExpression: cronExpression.trim(),
			description: description.trim() || undefined,
			enabled,
		});
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="rounded-lg border border-border bg-muted/30 p-4 space-y-4"
		>
			<div className="space-y-1.5">
				<Label htmlFor="job-name">Name</Label>
				<Input
					id="job-name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g. Daily standup summary"
					className="h-8 text-sm"
				/>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="job-prompt">Prompt</Label>
				<Textarea
					id="job-prompt"
					value={checkInPrompt}
					onChange={(e) => setCheckInPrompt(e.target.value)}
					placeholder="What should the coworker do on each check-in?"
					className="text-sm resize-none min-h-[80px]"
				/>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="job-cron">Cron Expression</Label>
				<Input
					id="job-cron"
					value={cronExpression}
					onChange={(e) => setCronExpression(e.target.value)}
					placeholder="0 9 * * *"
					className="h-8 text-sm"
				/>
				{cronDescription && <p className="text-xs text-muted-foreground">{cronDescription}</p>}
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="job-description">Description</Label>
				<Input
					id="job-description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Optional description"
					className="h-8 text-sm"
				/>
			</div>

			<div className="flex items-center gap-2">
				<Switch id="job-enabled" checked={enabled} onCheckedChange={setEnabled} />
				<Label htmlFor="job-enabled" className="text-sm font-normal text-muted-foreground">
					Enabled
				</Label>
			</div>

			<div className="flex items-center gap-2 pt-1">
				<Button type="submit" size="sm" disabled={!isValid || isSubmitting}>
					{isSubmitting ? "Saving..." : "Save"}
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
