"use client";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";

interface MetadataSelectorItem {
	id: string;
	label: string;
	metadata?: string;
	icon?: React.ReactNode;
}

interface ItemAction {
	icon: React.ReactNode;
	onClick: (itemId: string, e: React.MouseEvent) => void;
	title?: string;
}

interface FooterAction {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
}

interface MetadataSelectorProps {
	items: MetadataSelectorItem[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	placeholder?: string;
	icon?: React.ReactNode;
	actions?: ItemAction[];
	footerAction?: FooterAction;
	disabled?: boolean;
	className?: string;
}

export function MetadataSelector({
	items,
	selectedId,
	onSelect,
	placeholder = "Select item",
	icon,
	actions,
	footerAction,
	disabled = false,
	className,
}: MetadataSelectorProps) {
	const selectedItem = items.find((item) => item.id === selectedId) || items[0];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					disabled={disabled}
					className={cn("w-full h-auto py-2 justify-between font-normal", className)}
				>
					<div className="flex items-center gap-2 min-w-0">
						{(selectedItem?.icon || icon) && (
							<span className="shrink-0">{selectedItem?.icon || icon}</span>
						)}
						<div className="flex flex-col items-start min-w-0">
							<span className="truncate">{selectedItem?.label || placeholder}</span>
							{selectedItem?.metadata && (
								<span className="text-xs text-muted-foreground truncate">
									{selectedItem.metadata}
								</span>
							)}
						</div>
					</div>
					<ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]" align="start">
				{items.map((item) => {
					const isSelected = item.id === selectedId || (items.length === 1 && !selectedId);
					return (
						<DropdownMenuItem
							key={item.id}
							onClick={() => onSelect(item.id)}
							className="flex items-center justify-between gap-2"
						>
							<div className="flex items-center gap-2 min-w-0">
								{isSelected ? (
									<Check className="h-4 w-4 text-primary shrink-0" />
								) : item.icon ? (
									<span className="shrink-0">{item.icon}</span>
								) : (
									<span className="w-4 shrink-0" />
								)}
								<div className="flex flex-col min-w-0">
									<span className="truncate">{item.label}</span>
									{item.metadata && (
										<span className="text-xs text-muted-foreground truncate">{item.metadata}</span>
									)}
								</div>
							</div>
							{actions && actions.length > 0 && (
								<div className="flex items-center gap-1 shrink-0">
									{actions.map((action) => (
										<button
											key={action.title}
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												action.onClick(item.id, e);
											}}
											className="p-1 rounded hover:bg-muted"
											title={action.title}
										>
											{action.icon}
										</button>
									))}
								</div>
							)}
						</DropdownMenuItem>
					);
				})}
				{footerAction && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={footerAction.onClick}
							disabled={footerAction.disabled}
							className="flex items-center gap-2"
						>
							{footerAction.icon}
							<span>{footerAction.label}</span>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
