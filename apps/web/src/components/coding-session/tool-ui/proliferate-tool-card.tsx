"use client";

import { BlocksIcon } from "@/components/ui/icons";
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
		<div className="my-2 rounded-lg border border-border bg-card p-3 shadow-keystone">
			<div className="flex items-center gap-2">
				<BlocksIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span
					className={`text-sm font-medium ${status === "error" ? "text-destructive" : "text-foreground"}`}
				>
					{label}
				</span>
				<span className="ml-auto shrink-0">
					{status === "running" && (
						<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					)}
					{status === "success" && <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
					{status === "error" && <XCircle className="h-3.5 w-3.5 text-destructive" />}
				</span>
			</div>
			{errorMessage && <p className="mt-1.5 text-xs text-destructive">{errorMessage}</p>}
			{children && <div className="mt-2 text-xs text-muted-foreground">{children}</div>}
		</div>
	);
}
