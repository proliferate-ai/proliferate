import { cn } from "@/lib/display/utils";
import * as React from "react";

type RoundIconActionIntent = "primary" | "muted";

export interface RoundIconActionButtonProps
	extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	icon: React.ReactNode;
	intent?: RoundIconActionIntent;
	loading?: boolean;
	ariaLabel: string;
}

const intentClasses: Record<RoundIconActionIntent, string> = {
	primary: "bg-primary text-primary-foreground hover:bg-primary/90",
	muted: "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
};

const RoundIconActionButton = React.forwardRef<HTMLButtonElement, RoundIconActionButtonProps>(
	(
		{ className, icon, intent = "primary", loading = false, ariaLabel, disabled, ...props },
		ref,
	) => {
		return (
			<button
				ref={ref}
				type="button"
				aria-label={ariaLabel}
				disabled={disabled || loading}
				className={cn(
					"inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
					"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					"disabled:pointer-events-none disabled:opacity-50",
					loading && "[&_svg]:animate-spin",
					intentClasses[intent],
					className,
				)}
				{...props}
			>
				{icon}
			</button>
		);
	},
);

RoundIconActionButton.displayName = "RoundIconActionButton";

export { RoundIconActionButton };
