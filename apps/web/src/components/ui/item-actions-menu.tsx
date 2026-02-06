"use client";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Copy, MoreVertical, Pencil, Trash2 } from "lucide-react";

interface CustomAction {
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
	variant?: "default" | "destructive";
}

interface ItemActionsMenuProps {
	onRename?: () => void;
	onDelete?: () => void;
	onDuplicate?: () => void;
	customActions?: CustomAction[];
	isVisible?: boolean;
	disabled?: boolean;
	className?: string;
	align?: "start" | "center" | "end";
}

export function ItemActionsMenu({
	onRename,
	onDelete,
	onDuplicate,
	customActions,
	isVisible = true,
	disabled = false,
	className,
	align = "end",
}: ItemActionsMenuProps) {
	const hasActions =
		onRename || onDelete || onDuplicate || (customActions && customActions.length > 0);

	if (!hasActions) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				onClick={(e) => e.stopPropagation()}
				disabled={disabled}
				className={cn(
					"p-0.5 rounded hover:bg-muted-foreground/10 transition-opacity",
					!isVisible && "opacity-0 group-hover:opacity-100",
					disabled && "pointer-events-none opacity-50",
					className,
				)}
			>
				<MoreVertical className="h-3.5 w-3.5" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align={align} onClick={(e) => e.stopPropagation()}>
				{onRename && (
					<DropdownMenuItem onClick={onRename}>
						<Pencil className="h-4 w-4 mr-2" />
						Rename
					</DropdownMenuItem>
				)}
				{onDuplicate && (
					<DropdownMenuItem onClick={onDuplicate}>
						<Copy className="h-4 w-4 mr-2" />
						Duplicate
					</DropdownMenuItem>
				)}
				{customActions?.map((action) => (
					<DropdownMenuItem
						key={action.label}
						onClick={action.onClick}
						className={cn(action.variant === "destructive" && "text-destructive")}
					>
						{action.icon}
						<span className="ml-2">{action.label}</span>
					</DropdownMenuItem>
				))}
				{onDelete && (
					<>
						{(onRename || onDuplicate || customActions?.length) && <DropdownMenuSeparator />}
						<DropdownMenuItem onClick={onDelete} className="text-destructive">
							<Trash2 className="h-4 w-4 mr-2" />
							Delete
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
