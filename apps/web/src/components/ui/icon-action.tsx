"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type IconActionSize = "xs" | "sm" | "md";
type IconActionVariant = "ghost" | "destructive";

interface IconActionProps {
	/** The icon to display */
	icon: ReactNode;
	/** Click handler */
	onClick: (e: React.MouseEvent) => void;
	/** Size of the button */
	size?: IconActionSize;
	/** Visual variant */
	variant?: IconActionVariant;
	/** Optional tooltip text */
	tooltip?: string;
	/** Whether the button is disabled */
	disabled?: boolean;
	/** Additional className for positioning (absolute, margin) - not styling */
	className?: string;
	/** Accessible label (required if no tooltip) */
	"aria-label"?: string;
}

const sizeClasses: Record<IconActionSize, { button: string; icon: string }> = {
	xs: { button: "h-5 w-5", icon: "h-3 w-3" },
	sm: { button: "h-7 w-7", icon: "h-3.5 w-3.5" },
	md: { button: "h-8 w-8", icon: "h-4 w-4" },
};

const variantClasses: Record<IconActionVariant, string> = {
	ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
	destructive: "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
};

/**
 * A small icon-only action button.
 * Used for edit, delete, close, expand/collapse actions.
 *
 * The component owns: size, colors, hover states, border-radius.
 * Use className for: positioning (absolute), visibility (opacity-0 group-hover:opacity-100).
 */
export function IconAction({
	icon,
	onClick,
	size = "sm",
	variant = "ghost",
	tooltip,
	disabled,
	className,
	"aria-label": ariaLabel,
}: IconActionProps) {
	const { button: buttonSize, icon: iconSize } = sizeClasses[size];

	const buttonElement = (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={ariaLabel || tooltip}
			className={cn(
				// Layout
				"inline-flex items-center justify-center",
				// Size
				buttonSize,
				// Shape
				"rounded-md",
				// Variant
				variantClasses[variant],
				// Disabled
				disabled && "opacity-50 cursor-not-allowed",
				// Transition
				"transition-colors",
				className,
			)}
		>
			<span className={iconSize}>{icon}</span>
		</button>
	);

	if (tooltip) {
		return (
			<TooltipProvider delayDuration={300}>
				<Tooltip>
					<TooltipTrigger asChild>{buttonElement}</TooltipTrigger>
					<TooltipContent side="top" className="text-xs">
						{tooltip}
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}

	return buttonElement;
}
