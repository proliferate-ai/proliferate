"use client";

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
import { Input } from "@/components/ui/input";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface SidebarItemProps {
	/** Unique identifier for the item */
	itemId: string;
	/** Whether this item is currently active/selected */
	isActive: boolean;
	/** Callback when navigation occurs (e.g., to close mobile sidebar) */
	onNavigate?: () => void;

	// Display
	/** The name to display (and edit) */
	displayName: string;
	/** Icon element to render */
	icon: React.ReactNode;
	/** Optional status indicator (e.g., StatusDot) shown before actions menu */
	statusIndicator?: React.ReactNode;

	// Click behavior
	/** Handler when item is clicked */
	onClick: () => void;

	// Mutations
	/** Function to rename the item */
	renameFn: (newName: string) => Promise<unknown>;
	/** Function to delete the item */
	deleteFn: () => Promise<unknown>;
	/** Query keys to invalidate on rename */
	renameQueryKeys: string[][];
	/** Query keys to invalidate on delete */
	deleteQueryKeys: string[][];
	/** Optimistic update for rename (optional) */
	onRenameOptimistic?: (newName: string) => void;
	/** Optimistic update for delete (optional) */
	onDeleteOptimistic?: () => void;

	// Delete dialog
	/** Title for delete confirmation dialog */
	deleteTitle: string;
	/** Description for delete confirmation dialog */
	deleteDescription: string;

	/** Whether to hide actions menu (e.g., during async operation) */
	hideActions?: boolean;
}

export function SidebarItem({
	itemId,
	isActive,
	onNavigate,
	displayName,
	icon,
	statusIndicator,
	onClick,
	renameFn,
	deleteFn,
	renameQueryKeys,
	deleteQueryKeys,
	deleteTitle,
	deleteDescription,
	hideActions,
}: SidebarItemProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(displayName);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();
	const queryClient = useQueryClient();

	// Focus input when entering edit mode
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const renameMutation = useMutation({
		mutationFn: renameFn,
		onSettled: () => {
			for (const key of renameQueryKeys) {
				queryClient.invalidateQueries({ queryKey: key });
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: deleteFn,
		onSuccess: () => {
			if (isActive) {
				router.push("/dashboard");
			}
		},
		onSettled: () => {
			for (const key of deleteQueryKeys) {
				queryClient.invalidateQueries({ queryKey: key });
			}
		},
	});

	const handleRename = () => {
		setEditValue(displayName);
		setIsEditing(true);
	};

	const handleSave = () => {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== displayName) {
			renameMutation.mutate(trimmed);
		}
		setIsEditing(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsEditing(false);
			setEditValue(displayName);
		}
	};

	const handleClick = () => {
		onClick();
		onNavigate?.();
	};

	return (
		<>
			<div
				onClick={handleClick}
				className={cn(
					"group relative flex items-center gap-[0.38rem] px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors",
					isActive
						? "bg-muted text-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-accent",
				)}
			>
				{/* Icon */}
				<div className="flex items-center justify-center shrink-0">{icon}</div>

				{/* Name */}
				<div className="flex-1 min-w-0 flex items-center">
					{isEditing ? (
						<Input
							ref={inputRef}
							type="text"
							variant="inline"
							size="auto"
							value={editValue}
							onChange={(e) => setEditValue(e.target.value)}
							onBlur={handleSave}
							onKeyDown={handleKeyDown}
							onClick={(e) => e.stopPropagation()}
							className="text-sm"
						/>
					) : (
						<span className="truncate">{displayName}</span>
					)}
				</div>

				{/* Trailing: status indicator + actions on hover */}
				<div className="shrink-0 flex items-center">
					{statusIndicator}
					{!hideActions && (
						<div className="opacity-0 group-hover:opacity-100 transition-opacity">
							<ItemActionsMenu
								onRename={handleRename}
								onDelete={() => setDeleteDialogOpen(true)}
								isVisible={isActive}
							/>
						</div>
					)}
				</div>
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
						<AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteMutation.mutate()}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
