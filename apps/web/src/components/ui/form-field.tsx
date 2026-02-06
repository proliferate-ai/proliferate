"use client";

import * as React from "react";

import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FormFieldProps extends InputProps {
	label: string;
	error?: string;
	description?: string;
	labelClassName?: string;
}

const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
	({ label, error, description, className, labelClassName, id, ...props }, ref) => {
		const generatedId = React.useId();
		const inputId = id || generatedId;
		const errorId = `${inputId}-error`;
		const descriptionId = `${inputId}-description`;

		return (
			<div className={cn("space-y-1.5", className)}>
				<Label
					htmlFor={inputId}
					className={cn(props.variant === "auth" && "text-xs text-neutral-500", labelClassName)}
				>
					{label}
				</Label>
				<Input
					ref={ref}
					id={inputId}
					aria-describedby={
						[error && errorId, description && descriptionId].filter(Boolean).join(" ") || undefined
					}
					aria-invalid={!!error}
					{...props}
				/>
				{description && !error && (
					<p id={descriptionId} className="text-[11px] text-neutral-600">
						{description}
					</p>
				)}
				{error && (
					<p id={errorId} className="text-xs text-destructive">
						{error}
					</p>
				)}
			</div>
		);
	},
);
FormField.displayName = "FormField";

export { FormField };
