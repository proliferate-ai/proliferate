import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const textVariants = cva("", {
	variants: {
		variant: {
			h1: "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl",
			h2: "scroll-m-20 text-3xl font-semibold tracking-tight",
			h3: "scroll-m-20 text-2xl font-semibold tracking-tight",
			h4: "scroll-m-20 text-xl font-semibold tracking-tight",
			body: "leading-7",
			small: "text-sm font-medium leading-none",
			label:
				"text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
			code: "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
		},
		color: {
			default: "",
			muted: "text-muted-foreground",
			destructive: "text-destructive",
			success: "text-green-600 dark:text-green-500",
			warning: "text-yellow-600 dark:text-yellow-500",
		},
	},
	defaultVariants: {
		variant: "body",
		color: "default",
	},
});

type TextElement = "h1" | "h2" | "h3" | "h4" | "p" | "span" | "code" | "label";

const variantElementMap: Record<
	NonNullable<VariantProps<typeof textVariants>["variant"]>,
	TextElement
> = {
	h1: "h1",
	h2: "h2",
	h3: "h3",
	h4: "h4",
	body: "p",
	small: "span",
	label: "label",
	code: "code",
};

export interface TextProps
	extends Omit<React.HTMLAttributes<HTMLElement>, "color">,
		VariantProps<typeof textVariants> {
	as?: TextElement;
}

const Text = React.forwardRef<HTMLElement, TextProps>(
	({ className, variant, color, as, ...props }, ref) => {
		const Comp = as || variantElementMap[variant || "body"];
		return React.createElement(Comp, {
			ref,
			className: cn(textVariants({ variant, color, className })),
			...props,
		});
	},
);
Text.displayName = "Text";

export { Text, textVariants };
