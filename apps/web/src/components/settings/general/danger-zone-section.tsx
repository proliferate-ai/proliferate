"use client";

import { SettingsSection } from "@/components/settings/settings-row";
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
import { useState } from "react";

interface DangerZoneSectionProps {
	organizationName: string;
}

export function DangerZoneSection({ organizationName }: DangerZoneSectionProps) {
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	return (
		<>
			<SettingsSection title="Danger zone">
				<div className="rounded-lg border border-destructive/30 bg-destructive/5">
					<div className="flex items-center justify-between gap-4 px-4 py-3">
						<div className="flex flex-col gap-0.5">
							<span className="text-sm font-medium">Delete workspace</span>
							<span className="text-xs text-muted-foreground">
								Permanently delete this workspace and all its data
							</span>
						</div>
						<Button
							variant="destructive"
							size="sm"
							className="h-8"
							onClick={() => setShowDeleteDialog(true)}
						>
							Delete
						</Button>
					</div>
				</div>
			</SettingsSection>

			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Workspace</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete the workspace &quot;
							{organizationName}&quot; and remove all associated data including repositories,
							sessions, and member access.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={async () => {
								setShowDeleteDialog(false);
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete Workspace
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
