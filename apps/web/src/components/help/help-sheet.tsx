"use client";

import { getHelpContent, helpTopics } from "@/content/help";
import { useHelpStore } from "@/stores/help";
import Markdown from "react-markdown";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export function HelpSheet() {
	const { isOpen, topic, closeHelp } = useHelpStore();

	const topicMeta = topic ? helpTopics[topic] : null;
	const content = topic ? getHelpContent(topic) : "";

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && closeHelp()}>
			<DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0">
				<DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
					<DialogTitle>{topicMeta?.title || "Help"}</DialogTitle>
					<DialogDescription>{topicMeta?.description}</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
					<div className="prose prose-sm dark:prose-invert max-w-none">
						<Markdown
							components={{
								// Skip h1 since we show it in the header
								h1: () => null,
								h2: ({ children }) => (
									<h2 className="text-base font-semibold mt-6 mb-2 first:mt-0">{children}</h2>
								),
								h3: ({ children }) => (
									<h3 className="text-sm font-semibold mt-4 mb-2">{children}</h3>
								),
								p: ({ children }) => (
									<p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>
								),
								ul: ({ children }) => (
									<ul className="text-sm text-muted-foreground list-disc list-outside ml-4 mb-3 space-y-1">
										{children}
									</ul>
								),
								ol: ({ children }) => (
									<ol className="text-sm text-muted-foreground list-decimal list-outside ml-4 mb-3 space-y-1">
										{children}
									</ol>
								),
								li: ({ children }) => <li className="leading-relaxed">{children}</li>,
								strong: ({ children }) => (
									<strong className="font-medium text-foreground">{children}</strong>
								),
								blockquote: ({ children }) => (
									<blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic my-3 text-sm text-muted-foreground">
										{children}
									</blockquote>
								),
								code: ({ children }) => (
									<code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
										{children}
									</code>
								),
							}}
						>
							{content}
						</Markdown>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
