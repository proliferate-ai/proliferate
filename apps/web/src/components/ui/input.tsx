import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const inputVariants = cva(
	"flex w-full text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
	{
		variants: {
			variant: {
				default:
					"rounded-md px-3 py-1 border border-input bg-background shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				auth: "rounded-md px-3 py-1 border border-white/[0.08] bg-white/[0.03] text-neutral-200 placeholder:text-neutral-600 focus:border-white/[0.15] focus:outline-none",
				inline:
					"bg-transparent border-0 border-b border-primary rounded-none px-0 py-0 outline-none focus-visible:outline-none focus-visible:ring-0",
			},
			size: {
				default: "h-9",
				lg: "h-10",
				auto: "h-auto",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface InputProps
	extends Omit<React.ComponentProps<"input">, "size">,
		VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className, type, variant, size, ...props }, ref) => {
		return (
			<input
				type={type}
				className={cn(inputVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		);
	},
);
Input.displayName = "Input";

export { Input, inputVariants };
