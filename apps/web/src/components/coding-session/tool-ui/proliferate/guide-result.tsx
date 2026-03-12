"use client";

interface GuidePreviewProps {
	text: string;
}

export function GuidePreview({ text }: GuidePreviewProps) {
	const lines = text.trim().split("\n").filter(Boolean);
	const preview = lines.slice(0, 6).join("\n");

	if (!preview) return null;

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
			<pre className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">{preview}</pre>
		</div>
	);
}
