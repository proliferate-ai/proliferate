"use client";

import { cn } from "@/lib/display/utils";
import type { FC } from "react";
import Markdown from "react-markdown";
import rehypeSanitize, { type Options } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const sanitizeSchema: Options = {
	strip: ["script"],
	tagNames: [
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"p",
		"br",
		"hr",
		"strong",
		"em",
		"del",
		"code",
		"pre",
		"ul",
		"ol",
		"li",
		"blockquote",
		"a",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
	],
	attributes: {
		a: ["href"],
		code: [["className", /^language-/]],
		ol: ["start"],
	},
	protocols: {
		href: ["http", "https"],
	},
};

interface SanitizedMarkdownProps {
	content: string;
	maxLength?: number | null;
	className?: string;
}

export const SanitizedMarkdown: FC<SanitizedMarkdownProps> = ({
	content,
	maxLength,
	className,
}) => {
	const text = maxLength ? content.slice(0, maxLength) : content;
	const truncated = maxLength != null && content.length > maxLength;

	return (
		<div className={cn("text-sm text-foreground", className)}>
			<Markdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
				components={{
					p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
					h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>,
					h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1">{children}</h2>,
					h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
					ul: ({ children }) => (
						<ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>
					),
					ol: ({ children }) => (
						<ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>
					),
					li: ({ children }) => <li className="leading-relaxed">{children}</li>,
					code: ({ className: codeClassName, children }) => {
						const isBlock = codeClassName?.includes("language-");
						return isBlock ? (
							<pre className="bg-muted rounded-lg p-2 my-2 overflow-x-auto">
								<code className="text-xs font-mono">{children}</code>
							</pre>
						) : (
							<code className="bg-muted rounded-md px-1 py-0.5 text-xs font-mono">{children}</code>
						);
					},
					pre: ({ children }) => <>{children}</>,
					strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
					blockquote: ({ children }) => (
						<blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic my-2">
							{children}
						</blockquote>
					),
					table: ({ children }) => (
						<div className="my-2 overflow-x-auto">
							<table className="w-full border-collapse text-sm">{children}</table>
						</div>
					),
					thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
					tbody: ({ children }) => <tbody>{children}</tbody>,
					tr: ({ children }) => <tr className="border-b border-border/50">{children}</tr>,
					th: ({ children }) => (
						<th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">
							{children}
						</th>
					),
					td: ({ children }) => <td className="px-3 py-1.5">{children}</td>,
					a: ({ href, children }) => (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary underline underline-offset-2 hover:text-primary/80"
						>
							{children}
						</a>
					),
				}}
			>
				{text}
			</Markdown>
			{truncated && <span className="text-xs text-muted-foreground">…</span>}
		</div>
	);
};
