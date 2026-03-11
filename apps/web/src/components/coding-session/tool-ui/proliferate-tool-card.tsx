"use client";

import { CheckCircle, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";

interface ProliferateToolCardProps {
	label: string;
	status: "running" | "success" | "error";
	errorMessage?: string;
	children?: ReactNode;
}

export function ProliferateToolCard({
	label,
	status,
	errorMessage,
	children,
}: ProliferateToolCardProps) {
	return (
		<div className="my-0.5 flex flex-col">
			<div className="flex items-center gap-1.5 py-0.5">
				<span className="shrink-0">
					{status === "running" && (
						<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
					)}
					{status === "success" && <CheckCircle className="h-3 w-3 text-muted-foreground/50" />}
					{status === "error" && <XCircle className="h-3 w-3 text-destructive" />}
				</span>
				<span
					className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
				>
					{label}
				</span>
			</div>
			{errorMessage && <p className="ml-4.5 text-xs text-destructive">{errorMessage}</p>}
			{children && <div className="ml-4.5 text-xs text-muted-foreground">{children}</div>}
		</div>
	);
}
