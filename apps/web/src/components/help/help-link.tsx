"use client";

import type { HelpTopic } from "@/content/help";
import { cn } from "@/lib/utils";
import { openHelp } from "@/stores/help";
import { HelpCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";

interface HelpLinkProps {
	topic: HelpTopic;
	children?: ReactNode;
	className?: string;
	/** Show as icon-only button */
	iconOnly?: boolean;
}

/**
 * A link/button that opens the help sheet for a specific topic.
 *
 * Usage:
 * ```tsx
 * <HelpLink topic="snapshots">Learn more</HelpLink>
 * <HelpLink topic="snapshots" iconOnly />
 * ```
 */
export function HelpLink({ topic, children, className, iconOnly }: HelpLinkProps) {
	const handleClick = () => {
		openHelp(topic);
	};

	if (iconOnly) {
		return (
			<Button
				variant="ghost"
				size="icon"
				className={cn("h-6 w-6 text-muted-foreground hover:text-foreground", className)}
				onClick={handleClick}
			>
				<HelpCircleIcon className="h-4 w-4" />
				<span className="sr-only">Help</span>
			</Button>
		);
	}

	return (
		<Button
			variant="link"
			onClick={handleClick}
			className={cn(
				"h-auto p-0 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground",
				className,
			)}
		>
			{children || "Learn more"}
		</Button>
	);
}
