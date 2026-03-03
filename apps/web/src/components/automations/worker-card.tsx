"use client";

import { StatusDot } from "@/components/ui/status-dot";
import { formatRelativeTime } from "@/lib/display/utils";
import Link from "next/link";

type WorkerStatus = "active" | "paused" | "degraded" | "failed";

interface WorkerCardProps {
	id: string;
	name: string;
	status: WorkerStatus;
	objective: string | null;
	lastWakeAt: string | null;
	activeTaskCount: number;
	pendingApprovalCount: number;
}

const statusDotMap: Record<WorkerStatus, "active" | "paused" | "error"> = {
	active: "active",
	paused: "paused",
	degraded: "error",
	failed: "error",
};

const statusLabels: Record<WorkerStatus, string> = {
	active: "Active",
	paused: "Paused",
	degraded: "Degraded",
	failed: "Failed",
};

// Deterministic color palette derived from name hash
const ORB_PALETTES = [
	["#7C3AED", "#2563EB", "#06B6D4"], // violet → blue → cyan
	["#EC4899", "#8B5CF6", "#6366F1"], // pink → purple → indigo
	["#F59E0B", "#EF4444", "#EC4899"], // amber → red → pink
	["#10B981", "#06B6D4", "#3B82F6"], // emerald → cyan → blue
	["#F97316", "#F59E0B", "#EAB308"], // orange → amber → yellow
	["#8B5CF6", "#EC4899", "#F43F5E"], // purple → pink → rose
	["#14B8A6", "#10B981", "#22C55E"], // teal → emerald → green
	["#6366F1", "#8B5CF6", "#A855F7"], // indigo → violet → purple
];

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

export function WorkerCard({
	id,
	name,
	status,
	objective,
	lastWakeAt,
	activeTaskCount,
	pendingApprovalCount,
}: WorkerCardProps) {
	const metaParts: string[] = [];
	metaParts.push(statusLabels[status]);
	if (activeTaskCount > 0)
		metaParts.push(`${activeTaskCount} task${activeTaskCount !== 1 ? "s" : ""}`);
	if (pendingApprovalCount > 0) metaParts.push(`${pendingApprovalCount} pending`);
	if (lastWakeAt) metaParts.push(formatRelativeTime(lastWakeAt));

	return (
		<Link
			href={`/coworkers/${id}`}
			className="group flex items-center gap-3.5 rounded-2xl p-3 hover:bg-muted/40 transition-colors"
		>
			<WorkerOrb name={name} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-foreground truncate">{name}</span>
					<StatusDot status={statusDotMap[status]} size="sm" className="shrink-0" />
				</div>
				{objective ? (
					<p className="text-xs text-muted-foreground mt-0.5 truncate">{objective}</p>
				) : (
					<p className="text-xs text-muted-foreground/60 mt-0.5">{metaParts.join(" · ")}</p>
				)}
			</div>
		</Link>
	);
}
