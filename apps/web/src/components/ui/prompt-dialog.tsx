"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PromptDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
	label?: string;
	placeholder?: string;
	defaultValue?: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm: (value: string) => void | Promise<void>;
	isLoading?: boolean;
}

export function PromptDialog({
	open,
	onOpenChange,
	title,
	description,
	label,
	placeholder,
	defaultValue = "",
	confirmText = "Confirm",
	cancelText = "Cancel",
	onConfirm,
	isLoading = false,
}: PromptDialogProps) {
	const [value, setValue] = React.useState(defaultValue);
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		if (open) {
			setValue(defaultValue);
			// Focus input after dialog opens
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [open, defaultValue]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!value.trim()) return;
		await onConfirm(value.trim());
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			onOpenChange(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						{description && <DialogDescription>{description}</DialogDescription>}
					</DialogHeader>
					<div className="py-4">
						{label && (
							<Label htmlFor="prompt-input" className="mb-2 block">
								{label}
							</Label>
						)}
						<Input
							ref={inputRef}
							id="prompt-input"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder={placeholder}
							disabled={isLoading}
						/>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isLoading}
						>
							{cancelText}
						</Button>
						<Button type="submit" disabled={!value.trim() || isLoading}>
							{confirmText}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
