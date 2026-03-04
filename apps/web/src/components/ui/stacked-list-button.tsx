import { cn } from "@/lib/display/utils";
import * as React from "react";

export interface StackedListButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const StackedListButton = React.forwardRef<HTMLButtonElement, StackedListButtonProps>(
	({ className, ...props }, ref) => {
		return (
			<button
				ref={ref}
				type="button"
				className={cn(
					"flex min-h-[2.75rem] w-full items-center justify-start rounded-none border border-border px-3 py-0 text-left text-muted-foreground transition-colors duration-75 -mb-px last:mb-0 hover:z-10 active:z-10 hover:bg-muted/50 active:bg-muted",
					"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					"disabled:pointer-events-none disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		);
	},
);

StackedListButton.displayName = "StackedListButton";

export { StackedListButton };
