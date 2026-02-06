"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SelectableItemProps {
	/** Whether the item is currently selected */
	selected?: boolean;
	/** Click handler */
	onClick: () => void;
	/** Optional icon on the left */
	icon?: ReactNode;
	/** Main content - can be simple text or complex ReactNode */
	children: ReactNode;
	/** Optional content on the right (checkmark, loading indicator, etc.) */
	rightContent?: ReactNode;
	/** Whether the item is disabled */
	disabled?: boolean;
	/** Additional className for layout (width, margin) - not styling */
	className?: string;
}

/**
 * A selectable list item with consistent selected/hover states.
 * Used in dropdowns, pickers, and selection lists.
 *
 * The component owns: colors, padding, border-radius, hover/selected states.
 * Use className for: width, margin, layout positioning.
 */
export function SelectableItem({
	selected,
	onClick,
	icon,
	children,
	rightContent,
	disabled,
	className,
}: SelectableItemProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				// Layout
				"flex items-center gap-2 px-3 py-2 w-full text-left text-sm",
				// Shape
				"rounded-md",
				// States
				selected ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground",
				// Disabled
				disabled && "opacity-50 cursor-not-allowed",
				// Transition
				"transition-colors",
				className,
			)}
		>
			{icon && <span className="flex-shrink-0 text-muted-foreground">{icon}</span>}
			<span className="flex-1 min-w-0">{children}</span>
			{rightContent && <span className="flex-shrink-0">{rightContent}</span>}
		</button>
	);
}

/** Simple text content that truncates */
export function SelectableItemText({ children }: { children: ReactNode }) {
	return <span className="truncate">{children}</span>;
}
