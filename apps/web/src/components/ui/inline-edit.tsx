"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";

interface InlineEditProps {
	value: string;
	onSave: (value: string) => void | Promise<void>;
	onCancel?: () => void;
	placeholder?: string;
	validate?: (value: string) => string | null;
	mode?: "blur" | "buttons";
	isLoading?: boolean;
	className?: string;
	inputClassName?: string;
	displayClassName?: string;
	children?: React.ReactNode;
}

export function InlineEdit({
	value,
	onSave,
	onCancel,
	placeholder = "Enter value",
	validate,
	mode = "blur",
	isLoading = false,
	className,
	inputClassName,
	displayClassName,
	children,
}: InlineEditProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Sync editValue when value prop changes (and not editing)
	useEffect(() => {
		if (!isEditing) {
			setEditValue(value);
		}
	}, [value, isEditing]);

	// Focus input when entering edit mode
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const handleSave = useCallback(async () => {
		const trimmedValue = editValue.trim();

		if (validate) {
			const validationError = validate(trimmedValue);
			if (validationError) {
				setError(validationError);
				return;
			}
		}

		if (trimmedValue && trimmedValue !== value) {
			await onSave(trimmedValue);
		}

		setError(null);
		setIsEditing(false);
	}, [editValue, value, validate, onSave]);

	const handleCancel = useCallback(() => {
		setEditValue(value);
		setError(null);
		setIsEditing(false);
		onCancel?.();
	}, [value, onCancel]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSave();
			} else if (e.key === "Escape") {
				e.preventDefault();
				handleCancel();
			}
		},
		[handleSave, handleCancel],
	);

	const handleBlur = useCallback(() => {
		if (mode === "blur") {
			handleSave();
		}
	}, [mode, handleSave]);

	if (!isEditing) {
		return (
			<div className={cn("cursor-text", className)} onClick={() => setIsEditing(true)}>
				{children || (
					<span className={cn("truncate", displayClassName)}>{value || placeholder}</span>
				)}
			</div>
		);
	}

	return (
		<div className={cn("space-y-2", className)}>
			<Input
				ref={inputRef}
				type="text"
				value={editValue}
				onChange={(e) => {
					setEditValue(e.target.value);
					setError(null);
				}}
				onBlur={handleBlur}
				onKeyDown={handleKeyDown}
				onClick={(e) => e.stopPropagation()}
				placeholder={placeholder}
				disabled={isLoading}
				className={cn(
					mode === "blur" &&
						"bg-transparent border-b border-primary rounded-none px-0 focus-visible:ring-0",
					inputClassName,
				)}
			/>
			{error && <p className="text-xs text-destructive">{error}</p>}
			{mode === "buttons" && (
				<div className="flex gap-2">
					<Button
						size="sm"
						variant="ghost"
						className="flex-1"
						onClick={handleCancel}
						disabled={isLoading}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						className="flex-1"
						onClick={handleSave}
						disabled={isLoading || !editValue.trim()}
					>
						{isLoading ? "Saving..." : "Save"}
					</Button>
				</div>
			)}
		</div>
	);
}
