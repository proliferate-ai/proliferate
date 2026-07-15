import { isValidElement, type ReactNode } from "react";
import {
  type MarkdownCodeBlockRenderInput,
  type MarkdownInlineCodeRenderInput,
  type MarkdownLinkRenderInput,
} from "@proliferate/product-ui/chat/transcript/MarkdownBody";
import { CodeBlock } from "@proliferate/product-ui/code/CodeBlock";
import { isExternalHttpLink } from "@proliferate/product-ui/chat/transcript/ProviderLinkMention";
import { FilePathLink } from "@/components/content/ui/FilePathLink";
import { useHighlightedTokens } from "@/hooks/ui/highlighting/use-highlighted-tokens";
import {
  looksLikeFileReferenceHref,
  looksLikePath,
  splitPathLineSuffix,
} from "@/lib/domain/files/path-detection";

/**
 * Desktop renderers injected into the product-ui transcript markdown
 * (AssistantMessage and plan cards). File-like link destinations and
 * path-like inline code render as FilePathLink mentions that open the file
 * in the workspace viewer; fenced code renders shiki-highlighted HTML inside
 * the shared product-ui code block shell.
 */
export function renderTranscriptLink({
  href,
  children,
}: MarkdownLinkRenderInput): ReactNode | null {
  // External web links (incl. scheme-less hosts like `github.com/...`) fall
  // through to the shared provider-icon mention in MarkdownBody; only
  // workspace file references become FilePathLinks here.
  if (isExternalHttpLink(href) || !looksLikeFileReferenceHref(href)) {
    return null;
  }
  const text = markdownChildrenText(children);
  // When the link text just repeats the path, drop it so FilePathLink shows
  // its canonical label (workspace-relative path plus line annotation).
  const label = text !== null && !isRedundantPathLabel(text, href)
    ? children
    : undefined;
  return <FilePathLink rawPath={href}>{label}</FilePathLink>;
}

export function renderTranscriptInlineCode({
  code,
}: MarkdownInlineCodeRenderInput): ReactNode | null {
  if (!looksLikePath(code)) {
    return null;
  }
  return <FilePathLink rawPath={code} />;
}

export function renderTranscriptCodeBlock({
  code,
  language,
}: MarkdownCodeBlockRenderInput): ReactNode {
  return <TranscriptHighlightedCodeBlock code={code} language={language} />;
}

function TranscriptHighlightedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const tokens = useHighlightedTokens(code, language ?? "text");
  return (
    <CodeBlock code={code} label={language} tokens={tokens} />
  );
}

function isRedundantPathLabel(text: string, href: string): boolean {
  const textPath = splitPathLineSuffix(text.trim()).path;
  const hrefPath = splitPathLineSuffix(href.trim()).path;
  if (!textPath) {
    return true;
  }
  return textPath === hrefPath
    || hrefPath.endsWith(`/${textPath}`)
    || textPath.endsWith(`/${hrefPath}`);
}

function markdownChildrenText(children: ReactNode): string | null {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (children === null || children === undefined || typeof children === "boolean") {
    return "";
  }
  if (Array.isArray(children)) {
    const parts = children.map(markdownChildrenText);
    return parts.every((part): part is string => part !== null) ? parts.join("") : null;
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return markdownChildrenText(children.props.children);
  }
  return null;
}
