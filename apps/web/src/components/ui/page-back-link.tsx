"use client";

import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface PageBackLinkProps {
	href: string;
	label: string;
	className?: string;
}

export function PageBackLink({ href, label, className }: PageBackLinkProps) {
	return (
		<Link
			href={href}
			className={cn(
				"flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors",
				className,
			)}
		>
			<ArrowLeft className="h-3 w-3" />
			{label}
		</Link>
	);
}
