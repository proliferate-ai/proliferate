"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactNode, forwardRef } from "react";

interface SelectorTriggerProps {
	/** Optional icon on the left */
	icon?: ReactNode;
	/** The display text */
	children: ReactNode;
	/** Placeholder text when no value is selected */
	placeholder?: string;
	/** Whether a value is currently selected (affects text color) */
	hasValue?: boolean;
	/** Additional className for width constraints */
	className?: string;
}

/**
 * A standardized trigger button for dropdown selectors.
 * Used with Radix Popover.Trigger asChild.
 *
 * The component owns: border, padding, colors, hover/focus states, chevron.
 * Use className for: width constraints.
 */
export const SelectorTrigger = forwardRef<HTMLButtonElement, SelectorTriggerProps>(
	({ icon, children, placeholder, hasValue = true, className, ...props }, ref) => {
		return (
			<button
				ref={ref}
				type="button"
				className={cn(
					// Layout
					"flex items-center gap-2 px-3 py-1.5",
					// Shape
					"rounded-md border border-input",
					// Colors
					"bg-background text-sm",
					// States
					"hover:bg-muted transition-colors",
					"focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					className,
				)}
				{...props}
			>
				{icon && <span className="flex-shrink-0 text-muted-foreground">{icon}</span>}
				<span
					className={cn(
						"flex-1 text-left truncate",
						hasValue ? "text-foreground" : "text-muted-foreground",
					)}
				>
					{hasValue ? children : placeholder || children}
				</span>
				<ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
			</button>
		);
	},
);

SelectorTrigger.displayName = "SelectorTrigger";
