"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface CollapsibleSectionProps {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
	className?: string;
}

export function CollapsibleSection({
	title,
	defaultOpen = true,
	children,
	className,
}: CollapsibleSectionProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<div className={cn("group/section", className)}>
			{/* Section header */}
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="group/header flex items-center gap-0.5 w-full px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<span>{title}</span>
				<ChevronDown
					className={cn(
						"h-3 w-3 transition-all",
						isOpen ? "opacity-0 group-hover/header:opacity-100" : "-rotate-90 opacity-100",
					)}
				/>
			</button>
			{/* Section content with smooth collapse */}
			<div
				className={cn(
					"overflow-hidden transition-all duration-200",
					isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
				)}
			>
				{children}
			</div>
		</div>
	);
}
