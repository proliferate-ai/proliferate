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
	activeTaskCount?: number;
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
	const [c0, c1, c2, structure] = palette;
	const rotation = hash % 360;
	const uid = `orb-${hash}`;

	return (
		<svg width={size} height={size} viewBox="0 0 40 40" className="shrink-0" aria-hidden="true">
			<defs>
				<clipPath id={`${uid}-clip`}>
					<circle cx="20" cy="20" r="20" />
				</clipPath>
				<filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="5" />
				</filter>
				<radialGradient id={`${uid}-hi`} cx="32%" cy="28%" r="36%">
					<stop offset="0%" stopColor="white" stopOpacity="0.22" />
					<stop offset="100%" stopColor="white" stopOpacity="0" />
				</radialGradient>
			</defs>

			{/* Structure-specific rendering */}
			{structure === "nebula" && (
				<>
					<circle cx="20" cy="20" r="20" fill={c0} />
					<g clipPath={`url(#${uid}-clip)`}>
						<g filter={`url(#${uid}-blur)`}>
							<circle
								cx={12 + (hash % 8)}
								cy={10 + ((hash >> 3) % 8)}
								r="14"
								fill={c1}
								opacity="0.85"
							/>
							<circle
								cx={24 + ((hash >> 5) % 8)}
								cy={26 + ((hash >> 7) % 6)}
								r="12"
								fill={c2}
								opacity="0.7"
							/>
							<circle
								cx={20 + ((hash >> 9) % 6)}
								cy={14 + ((hash >> 11) % 6)}
								r="8"
								fill={c0}
								opacity="0.5"
							/>
						</g>
					</g>
				</>
			)}

			{structure === "glow" && (
				<>
					<defs>
						<radialGradient
							id={`${uid}-glow`}
							cx={`${35 + (hash % 20)}%`}
							cy={`${30 + ((hash >> 3) % 20)}%`}
							r="65%"
						>
							<stop offset="0%" stopColor={c2} />
							<stop offset="40%" stopColor={c1} />
							<stop offset="100%" stopColor={c0} />
						</radialGradient>
					</defs>
					<circle cx="20" cy="20" r="20" fill={`url(#${uid}-glow)`} />
					<g clipPath={`url(#${uid}-clip)`}>
						<g filter={`url(#${uid}-blur)`}>
							<circle
								cx={16 + (hash % 10)}
								cy={16 + ((hash >> 4) % 10)}
								r="10"
								fill={c2}
								opacity="0.6"
							/>
						</g>
					</g>
				</>
			)}

			{structure === "split" && (
				<>
					<defs>
						<linearGradient
							id={`${uid}-split`}
							x1="0"
							y1="0"
							x2="1"
							y2="1"
							gradientTransform={`rotate(${rotation % 90}, 0.5, 0.5)`}
						>
							<stop offset="0%" stopColor={c0} />
							<stop offset="50%" stopColor={c1} />
							<stop offset="100%" stopColor={c2} />
						</linearGradient>
					</defs>
					<circle cx="20" cy="20" r="20" fill={`url(#${uid}-split)`} />
					<g clipPath={`url(#${uid}-clip)`}>
						<g filter={`url(#${uid}-blur)`}>
							<ellipse
								cx={14 + (hash % 6)}
								cy={14 + ((hash >> 3) % 6)}
								rx="16"
								ry="10"
								fill={c2}
								opacity="0.5"
								transform={`rotate(${(rotation % 45) + 20}, 20, 20)`}
							/>
						</g>
					</g>
				</>
			)}

			{/* Specular highlight for depth */}
			<circle cx="20" cy="20" r="20" fill={`url(#${uid}-hi)`} />
		</svg>
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
	activeTaskCount,
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
				{(visibleBadges.length > 0 || (activeTaskCount != null && activeTaskCount > 0)) && (
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
						{activeTaskCount != null && activeTaskCount > 0 && (
							<>
								{visibleBadges.length > 0 && (
									<span className="text-muted-foreground/30 text-[10px]">&middot;</span>
								)}
								<span className="text-[10px] text-muted-foreground/70 tabular-nums">
									{activeTaskCount} {activeTaskCount === 1 ? "task" : "tasks"}
								</span>
							</>
						)}
					</div>
				)}
				<p className="text-[10px] text-muted-foreground/60 mt-0.5">{lastActiveLabel}</p>
			</div>
		</Link>
	);
}
