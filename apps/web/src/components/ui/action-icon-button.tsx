"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ActionIconButtonProps {
	icon: React.ReactNode;
	onClick: (e: React.MouseEvent) => void;
	tooltip?: string;
	variant?: "default" | "destructive" | "muted";
	size?: "xs" | "sm";
	isLoading?: boolean;
	disabled?: boolean;
	className?: string;
}

export function ActionIconButton({
	icon,
	onClick,
	tooltip,
	variant = "muted",
	size = "sm",
	isLoading = false,
	disabled = false,
	className,
}: ActionIconButtonProps) {
	const sizeClasses = {
		xs: "p-0.5",
		sm: "p-1",
	};

	const variantClasses = {
		default: "text-foreground hover:bg-muted",
		destructive: "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
		muted: "text-muted-foreground hover:text-foreground hover:bg-muted",
	};

	const button = (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				if (!disabled && !isLoading) {
					onClick(e);
				}
			}}
			disabled={disabled || isLoading}
			className={cn(
				"rounded transition-colors",
				sizeClasses[size],
				variantClasses[variant],
				(disabled || isLoading) && "pointer-events-none opacity-50",
				isLoading && "[&_svg]:animate-spin",
				className,
			)}
		>
			{icon}
		</button>
	);

	if (tooltip) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
		);
	}

	return button;
}
