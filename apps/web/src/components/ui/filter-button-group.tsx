"use client";

import { cn } from "@/lib/utils";

interface FilterItem<T> {
	value: T;
	label: string;
}

interface FilterButtonGroupProps<T extends string | number> {
	items: FilterItem<T>[];
	selected: T[];
	onChange: (selected: T[]) => void;
	size?: "sm" | "default";
	className?: string;
}

export function FilterButtonGroup<T extends string | number>({
	items,
	selected,
	onChange,
	size = "default",
	className,
}: FilterButtonGroupProps<T>) {
	const handleToggle = (value: T) => {
		const isSelected = selected.includes(value);
		onChange(isSelected ? selected.filter((v) => v !== value) : [...selected, value]);
	};

	return (
		<div className={cn("flex flex-wrap gap-1", className)}>
			{items.map((item) => {
				const isSelected = selected.includes(item.value);
				return (
					<button
						key={String(item.value)}
						type="button"
						onClick={() => handleToggle(item.value)}
						className={cn(
							"rounded transition-colors",
							size === "sm" ? "px-2 py-0.5 text-xs" : "px-2 py-1 text-xs",
							isSelected ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80",
						)}
					>
						{item.label}
					</button>
				);
			})}
		</div>
	);
}
