import { cn } from "@/lib/utils";
import * as React from "react";

export interface CardButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

/**
 * A button component designed for card-like clickable containers.
 * Unlike Button, this doesn't have centered content, forced SVG sizes,
 * or whitespace-nowrap - making it suitable for multi-line card layouts.
 */
const CardButton = React.forwardRef<HTMLButtonElement, CardButtonProps>(
	({ className, ...props }, ref) => {
		return (
			<button
				type="button"
				ref={ref}
				className={cn(
					"flex flex-col text-left transition-colors",
					"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					"disabled:pointer-events-none disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		);
	},
);
CardButton.displayName = "CardButton";

export { CardButton };
