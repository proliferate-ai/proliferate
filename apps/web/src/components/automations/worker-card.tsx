"use client";

import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import {
	ORB_PALETTES,
	WORKER_STATUS_DOT_MAP,
	WORKER_STATUS_LABELS,
	type WorkerStatus,
} from "@/config/coworkers";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

interface WorkerCardProps {
	id: string;
	name: string;
	status: WorkerStatus;
	description: string | null;
	capabilities?: string[];
	updatedAt?: Date | string;
}

function hashName(name: string): number {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash << 5) - hash + name.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

export function WorkerOrb({ name, size = 40 }: { name: string; size?: number }) {
	const hash = hashName(name);
	const palette = ORB_PALETTES[hash % ORB_PALETTES.length];
	const rotation = hash % 360;
	const id = `orb-${hash % 9999}`;

	return (
		<div
			className="rounded-xl bg-muted/50 overflow-hidden shrink-0 relative"
			style={{ width: size, height: size }}
		>
			<svg viewBox="0 0 40 40" className="w-full h-full">
				<defs>
					<radialGradient id={`${id}-a`} cx="30%" cy="30%" r="70%">
						<stop offset="0%" stopColor={palette[0]} stopOpacity="0.9" />
						<stop offset="100%" stopColor={palette[1]} stopOpacity="0.3" />
					</radialGradient>
					<radialGradient id={`${id}-b`} cx="70%" cy="70%" r="60%">
						<stop offset="0%" stopColor={palette[2]} stopOpacity="0.8" />
						<stop offset="100%" stopColor={palette[1]} stopOpacity="0.1" />
					</radialGradient>
					<filter id={`${id}-blur`}>
						<feGaussianBlur stdDeviation="3" />
					</filter>
				</defs>
				<g filter={`url(#${id}-blur)`} transform={`rotate(${rotation} 20 20)`}>
					<circle cx="15" cy="14" r="14" fill={`url(#${id}-a)`} />
					<circle cx="26" cy="26" r="12" fill={`url(#${id}-b)`} />
				</g>
			</svg>
		</div>
	);
}

function formatRelativeTime(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Extract unique integration names from capability keys.
 * Capability keys look like "github.create_issue" → extract "github".
 */
function deriveIntegrationLabels(capabilities: string[]): string[] {
	const seen = new Set<string>();
	for (const cap of capabilities) {
		const dotIdx = cap.indexOf(".");
		if (dotIdx > 0) {
			seen.add(cap.slice(0, dotIdx));
		} else {
			seen.add(cap);
		}
	}
	return [...seen];
}

export function WorkerCard({
	id,
	name,
	status,
	description,
	capabilities = [],
	updatedAt,
}: WorkerCardProps) {
	// Capability badges: extract unique integration names
	const integrationLabels = deriveIntegrationLabels(capabilities);
	const maxBadges = 3;
	const visibleBadges = integrationLabels.slice(0, maxBadges);
	const overflowCount = integrationLabels.length - maxBadges;

	// Last active
	const isActive = status === "active";
	const lastActiveLabel = isActive
		? "Active now"
		: updatedAt
			? formatRelativeTime(updatedAt)
			: WORKER_STATUS_LABELS[status];

	return (
		<Link
			href={`/coworkers/${id}`}
			className="group flex items-center gap-3.5 rounded-2xl p-3 hover:bg-muted/40 transition-colors"
		>
			<WorkerOrb name={name} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-foreground truncate">{name}</span>
					<StatusDot status={WORKER_STATUS_DOT_MAP[status]} size="sm" className="shrink-0" />
				</div>
				{description && (
					<p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
				)}
				{visibleBadges.length > 0 && (
					<div className="flex items-center gap-1 mt-0.5">
						{visibleBadges.map((label) => (
							<Badge
								key={label}
								variant="secondary"
								className="text-[10px] px-1.5 py-0 h-4 font-normal capitalize"
							>
								{label}
							</Badge>
						))}
						{overflowCount > 0 && (
							<Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
								+{overflowCount}
							</Badge>
						)}
					</div>
				)}
				<p className="text-[10px] text-muted-foreground/60 mt-0.5">{lastActiveLabel}</p>
			</div>
		</Link>
	);
}
