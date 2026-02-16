"use client";

import { AlertTriangle, Check } from "lucide-react";

export interface ValidationResultData {
	ok: boolean;
	tools: Array<{ name: string; description: string; riskLevel: string }>;
	error: string | null;
	diagnostics: { class: string; message: string } | null;
}

export interface ValidationResultProps {
	result: ValidationResultData;
}

export function ValidationResult({ result }: ValidationResultProps) {
	if (result.ok) {
		return (
			<div className="rounded-md border border-green-600/30 bg-green-600/5 p-3">
				<div className="flex items-center gap-2 mb-2">
					<Check className="h-4 w-4 text-green-600" />
					<span className="text-xs font-medium text-green-600">
						Connected — {result.tools.length} tool{result.tools.length !== 1 ? "s" : ""} discovered
					</span>
				</div>
				<div className="space-y-1">
					{result.tools.map((t) => (
						<div key={t.name} className="flex items-center justify-between text-xs">
							<span className="text-foreground">{t.name}</span>
							<span className="text-muted-foreground">{t.riskLevel}</span>
						</div>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
			<div className="flex items-center gap-2 mb-1">
				<AlertTriangle className="h-4 w-4 text-destructive" />
				<span className="text-xs font-medium text-destructive">
					{result.diagnostics?.class === "auth"
						? "Authentication failed"
						: result.diagnostics?.class === "timeout"
							? "Connection timed out"
							: result.diagnostics?.class === "unreachable"
								? "Server unreachable"
								: result.diagnostics?.class === "protocol"
									? "Protocol error"
									: "Connection failed"}
				</span>
			</div>
			{result.error && (
				<p className="text-xs text-muted-foreground mt-1 break-all">{result.error}</p>
			)}
		</div>
	);
}
