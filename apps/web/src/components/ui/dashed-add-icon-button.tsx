import { cn } from "@/lib/display/utils";
import * as React from "react";

type DashedAddIconButtonSize = "sm" | "md";

export interface DashedAddIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	size?: DashedAddIconButtonSize;
	ariaLabel: string;
}

const sizeClasses: Record<DashedAddIconButtonSize, string> = {
	sm: "h-8 w-8",
	md: "h-9 w-9",
};

const DashedAddIconButton = React.forwardRef<HTMLButtonElement, DashedAddIconButtonProps>(
	({ className, size = "sm", ariaLabel, ...props }, ref) => {
		return (
			<button
				ref={ref}
				type="button"
				aria-label={ariaLabel}
				className={cn(
					"inline-flex items-center justify-center rounded-full border border-dashed border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:border-primary/50",
					"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					"disabled:pointer-events-none disabled:opacity-50",
					sizeClasses[size],
					className,
				)}
				{...props}
			/>
		);
	},
);

DashedAddIconButton.displayName = "DashedAddIconButton";

export { DashedAddIconButton };
