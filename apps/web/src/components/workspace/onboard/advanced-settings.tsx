"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/display/utils";
import { orpc } from "@/lib/infra/orpc";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

interface AdvancedSettingsProps {
	repoId: string | null;
	startingBranch: string;
	onBranchChange: (branch: string) => void;
	snapshotId: string | null;
	onSnapshotChange: (id: string | null) => void;
}

export function AdvancedSettings({
	repoId,
	startingBranch,
	onBranchChange,
	snapshotId,
	onSnapshotChange,
}: AdvancedSettingsProps) {
	const [open, setOpen] = useState(false);

	const { data: snapshotsData } = useQuery({
		...orpc.configurations.listSnapshots.queryOptions({
			input: { repoId: repoId ?? "" },
		}),
		enabled: !!repoId && open,
	});

	const snapshots = snapshotsData?.snapshots ?? [];

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground text-muted-foreground"
			>
				<ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
				Advanced Settings
			</button>
			{open && (
				<div className="mt-3 space-y-4 pl-5">
					<div className="space-y-2">
						<Label htmlFor="branch" className="text-xs">
							Starting branch
						</Label>
						<Input
							id="branch"
							value={startingBranch}
							onChange={(e) => onBranchChange(e.target.value)}
							placeholder="main"
							className="h-8 text-sm"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="snapshot" className="text-xs">
							Start from existing environment
						</Label>
						<Select
							value={snapshotId ?? "none"}
							onValueChange={(v) => onSnapshotChange(v === "none" ? null : v)}
						>
							<SelectTrigger id="snapshot" className="h-8 text-sm">
								<SelectValue placeholder="None (fresh start)" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">None (fresh start)</SelectItem>
								{snapshots.map((s) => (
									<SelectItem key={s.id} value={s.snapshotId}>
										Snapshot {s.snapshotId.slice(0, 8)}
										{s.createdAt ? ` — ${new Date(s.createdAt).toLocaleDateString()}` : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			)}
		</div>
	);
}
