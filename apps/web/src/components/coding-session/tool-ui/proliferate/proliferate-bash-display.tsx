"use client";

import { normalizeActionsCatalog } from "@/lib/sessions/proliferate/catalog";
import type { ProliferateCommand } from "@/lib/sessions/proliferate/command-parser";
import { resolveIconKey } from "@/lib/sessions/proliferate/command-parser";
import {
	normalizeGmailMessageDetail,
	normalizeGmailMessageHandles,
	normalizeGmailMessageList,
	normalizeGmailMutationSummary,
} from "@/lib/sessions/proliferate/gmail";
import {
	humanizeAction,
	resolveIntegrationLabel,
	resolvePresentation,
} from "@/lib/sessions/proliferate/presentation-registry";
import { ActionCardShell } from "./action-card-shell";
import { ActionsCatalogSummaryView } from "./catalog-result";
import {
	GmailMessageDetailView,
	GmailMessageHandlesSummaryView,
	GmailMessageList,
	GmailMutationSummaryView,
} from "./gmail-result";
import { GuidePreview } from "./guide-result";

interface ProliferateBashDisplayProps {
	parsed: ProliferateCommand;
	result?: unknown;
	status?: { type: string };
	command?: string;
}

export function ProliferateBashDisplay({
	parsed,
	result,
	status,
	command,
}: ProliferateBashDisplayProps) {
	const errorMessage = getErrorMessage(result);

	if (parsed.kind === "actions-list") {
		const summary = normalizeActionsCatalog(result);
		return (
			<ActionCardShell
				iconKey="custom"
				label="Listed integrations"
				status={status}
				meta="Proliferate CLI"
				command={command}
				rawResult={result}
				errorMessage={errorMessage}
			>
				{summary ? (
					<ActionsCatalogSummaryView summary={summary} />
				) : (
					<GenericSummary result={result} />
				)}
			</ActionCardShell>
		);
	}

	if (parsed.kind === "actions-guide") {
		const iconKey = resolveIconKey(parsed.integration, "");
		const integrationLabel = resolveProviderLabel(iconKey, parsed.integration);
		return (
			<ActionCardShell
				iconKey={iconKey}
				label={`${integrationLabel} usage guide`}
				status={status}
				meta={`${integrationLabel} via Proliferate CLI`}
				command={command}
				rawResult={result}
				errorMessage={errorMessage}
			>
				{typeof result === "string" ? (
					<GuidePreview text={result} />
				) : (
					<GenericSummary result={result} />
				)}
			</ActionCardShell>
		);
	}

	if (parsed.kind === "actions-run") {
		const { integration, action } = parsed;
		const iconKey = resolveIconKey(integration, action);
		const presentation = resolvePresentation(integration, action);
		const integrationLabel = resolveProviderLabel(iconKey, integration);

		const children = renderResult(presentation.kind, action, result);

		return (
			<ActionCardShell
				iconKey={iconKey}
				label={presentation.label}
				status={status}
				meta={`${integrationLabel} via Proliferate CLI`}
				command={command}
				rawResult={result}
				errorMessage={errorMessage}
			>
				{children}
			</ActionCardShell>
		);
	}

	if (parsed.kind === "services") {
		const label = parsed.name
			? `${humanizeAction(parsed.subcommand)} · ${parsed.name}`
			: humanizeAction(parsed.subcommand);
		return (
			<ActionCardShell
				iconKey="custom"
				label={label}
				status={status}
				meta="Proliferate CLI"
				command={command}
				rawResult={result}
				errorMessage={errorMessage}
			>
				<GenericSummary result={result} />
			</ActionCardShell>
		);
	}

	if (parsed.kind === "env") {
		return (
			<ActionCardShell
				iconKey="custom"
				label={`env ${parsed.subcommand}`}
				status={status}
				meta="Proliferate CLI"
				command={command}
				rawResult={result}
				errorMessage={errorMessage}
			>
				<GenericSummary result={result} />
			</ActionCardShell>
		);
	}

	return null;
}

function renderResult(kind: string, action: string, result: unknown): React.ReactNode {
	const upper = action.toUpperCase();

	if (kind === "messageList") {
		if (upper.startsWith("GMAIL_")) {
			const rows = normalizeGmailMessageList(result);
			if (rows) return <GmailMessageList rows={rows} />;
		}
		return <GenericSummary result={result} />;
	}

	if (kind === "messageHandles") {
		if (upper.startsWith("GMAIL_")) {
			const handles = normalizeGmailMessageHandles(result);
			if (handles) {
				return (
					<GmailMessageHandlesSummaryView
						summary={handles}
						label={upper === "GMAIL_LIST_THREADS" ? "thread" : "message"}
					/>
				);
			}
		}
		return <GenericSummary result={result} />;
	}

	if (kind === "messageDetail") {
		if (upper.startsWith("GMAIL_")) {
			const detail = normalizeGmailMessageDetail(result);
			if (detail) return <GmailMessageDetailView detail={detail} />;
		}
		return <GenericSummary result={result} />;
	}

	if (kind === "mutationSummary") {
		if (upper.startsWith("GMAIL_")) {
			const summary = normalizeGmailMutationSummary(result);
			if (summary) return <GmailMutationSummaryView summary={summary} />;
		}
		return <GenericSummary result={result} />;
	}

	return <GenericSummary result={result} />;
}

function getErrorMessage(result: unknown): string | null {
	if (typeof result === "string") {
		const trimmed = result.trim();
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			const parsedError = parsed.error;
			if (typeof parsedError === "string" && parsedError.length > 0) return parsedError;
			return null;
		} catch {
			return /^error:/i.test(trimmed) ? trimmed : null;
		}
	}
	if (!result || typeof result !== "object") return null;
	const error = (result as Record<string, unknown>).error;
	return typeof error === "string" && error.length > 0 ? error : null;
}

function GenericSummary({ result }: { result: unknown }) {
	if (result === undefined || result === null) return null;
	if (isTruncatedResult(result)) {
		return (
			<div className="rounded-xl border border-border bg-card shadow-sm px-3 py-2 text-xs text-muted-foreground">
				Result truncated by the CLI. Open the raw result for full details.
			</div>
		);
	}
	if (typeof result === "string" && result.trim().length > 0) {
		return (
			<div className="rounded-xl border border-border bg-card shadow-sm px-3 py-2 text-xs text-muted-foreground">
				Raw output available.
			</div>
		);
	}
	if (typeof result === "object") {
		return (
			<div className="rounded-xl border border-border bg-card shadow-sm px-3 py-2 text-xs text-muted-foreground">
				Structured result available.
			</div>
		);
	}
	return null;
}

function isTruncatedResult(result: unknown): boolean {
	return Boolean(
		result && typeof result === "object" && (result as Record<string, unknown>)._truncated,
	);
}

function resolveProviderLabel(iconKey: string, integration: string): string {
	if (iconKey === "gmail") return "Gmail";
	if (iconKey === "slack") return "Slack";
	if (iconKey === "github") return "GitHub";
	if (iconKey === "linear") return "Linear";
	if (iconKey === "sentry") return "Sentry";
	return resolveIntegrationLabel(integration);
}
