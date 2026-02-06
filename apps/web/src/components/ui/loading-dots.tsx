import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

const loadingDotsVariants = cva("inline-flex items-center", {
	variants: {
		size: {
			sm: "gap-0.5",
			md: "gap-1",
			lg: "gap-1.5",
		},
	},
	defaultVariants: {
		size: "md",
	},
});

const dotVariants = cva("rounded-full bg-current animate-bounce-dot", {
	variants: {
		size: {
			sm: "h-1 w-1",
			md: "h-1.5 w-1.5",
			lg: "h-2 w-2",
		},
	},
	defaultVariants: {
		size: "md",
	},
});

export interface LoadingDotsProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof loadingDotsVariants> {
	label?: string;
	layout?: "inline" | "centered";
}

const LoadingDots = React.forwardRef<HTMLDivElement, LoadingDotsProps>(
	({ className, size = "md", layout = "inline", label, ...props }, ref) => {
		const dots = (
			<span className={cn(loadingDotsVariants({ size }))}>
				<span className={cn(dotVariants({ size }))} style={{ animationDelay: "0ms" }} />
				<span className={cn(dotVariants({ size }))} style={{ animationDelay: "150ms" }} />
				<span className={cn(dotVariants({ size }))} style={{ animationDelay: "300ms" }} />
			</span>
		);

		if (layout === "centered") {
			return (
				<div
					ref={ref}
					className={cn("flex flex-col items-center justify-center", className)}
					role="status"
					aria-label={label || "Loading"}
					{...props}
				>
					{dots}
					{label && <span className="mt-3 text-sm text-muted-foreground">{label}</span>}
				</div>
			);
		}

		return (
			<span
				ref={ref as React.Ref<HTMLSpanElement>}
				className={cn("inline-flex items-center gap-1.5", className)}
				role="status"
				aria-label={label || "Loading"}
				{...props}
			>
				{dots}
				{label && <span className="text-xs">{label}</span>}
			</span>
		);
	},
);
LoadingDots.displayName = "LoadingDots";

export { LoadingDots, loadingDotsVariants };
