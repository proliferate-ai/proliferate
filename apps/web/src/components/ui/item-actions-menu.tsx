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
	disabled?: boolean;
	description?: string;
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
	onOpenChange?: (open: boolean) => void;
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
	onOpenChange,
}: ItemActionsMenuProps) {
	const hasActions =
		onRename || onDelete || onDuplicate || (customActions && customActions.length > 0);

	if (!hasActions) return null;

	return (
		<DropdownMenu onOpenChange={onOpenChange}>
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
						onClick={action.disabled ? undefined : action.onClick}
						disabled={action.disabled}
						className={cn(action.variant === "destructive" && "text-destructive")}
					>
						{action.icon}
						<div className="ml-2">
							<span>{action.label}</span>
							{action.description && (
								<span className="block text-[11px] text-muted-foreground font-normal">
									{action.description}
								</span>
							)}
						</div>
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
