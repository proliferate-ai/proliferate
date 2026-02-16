"use client";

import { cn } from "@/lib/utils";

type ActionMode = "allow" | "require_approval" | "deny";

interface PermissionControlProps {
	value: ActionMode;
	onChange: (mode: ActionMode) => void;
	disabled?: boolean;
}

const MODES: { value: ActionMode; label: string }[] = [
	{ value: "allow", label: "Allow" },
	{ value: "require_approval", label: "Approval" },
	{ value: "deny", label: "Deny" },
];

export function PermissionControl({ value, onChange, disabled }: PermissionControlProps) {
	return (
		<div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
			{MODES.map((mode) => (
				<button
					key={mode.value}
					type="button"
					disabled={disabled}
					onClick={() => onChange(mode.value)}
					className={cn(
						"px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
						value === mode.value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
						disabled && "opacity-50 cursor-not-allowed",
					)}
				>
					{mode.label}
				</button>
			))}
		</div>
	);
}
