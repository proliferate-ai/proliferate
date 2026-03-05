"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
	GitDiffMessage,
	GitFileChange,
	GitResultMessage,
	GitState,
} from "@proliferate/shared";
import {
	AlertTriangle,
	ChevronDown,
	FileCode2,
	GitBranch,
	GitCommit,
	GitPullRequest,
	Loader2,
	Plus,
	RefreshCcw,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelShell } from "./panel-shell";

interface WorkspaceOption {
	workspacePath: string;
	label: string;
}

interface GitPanelProps {
	gitState: GitState | null;
	gitResult: GitResultMessage["payload"] | null;
	gitDiff: GitDiffMessage["payload"] | null;
	workspaceOptions?: WorkspaceOption[];
	sendGetGitStatus?: (workspacePath?: string) => void;
	sendGetGitDiff?: (
		path: string,
		scope?: "unstaged" | "staged" | "full",
		workspacePath?: string,
	) => void;
	sendGitCreateBranch?: (branchName: string, workspacePath?: string) => void;
	sendGitCommit?: (
		message: string,
		opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
	) => void;
	sendGitPush?: (workspacePath?: string) => void;
	sendGitCreatePr?: (
		title: string,
		body?: string,
		baseBranch?: string,
		workspacePath?: string,
	) => void;
	clearGitResult?: () => void;
}

type ChangeScope = "working" | "full";

interface FileRow {
	path: string;
	label: string;
	statusClassName: string;
	priority: number;
}

const IGNORED_GIT_PATH_PREFIXES = [".opencode/", ".proliferate/"] as const;
const IGNORED_GIT_PATH_EXACT = ["opencode.json", ".opencode.json"] as const;

function shouldIgnoreGitPath(path: string): boolean {
	const normalizedPath = path.replace(/^(?:\.\/)+/, "");
	if (IGNORED_GIT_PATH_EXACT.includes(normalizedPath as (typeof IGNORED_GIT_PATH_EXACT)[number])) {
		return true;
	}
	return IGNORED_GIT_PATH_PREFIXES.some(
		(prefix) =>
			normalizedPath === prefix ||
			normalizedPath === prefix.slice(0, -1) ||
			normalizedPath.startsWith(prefix),
	);
}

function getPullRequestNumberFromUrl(url: string): string | null {
	const match = url.match(/\/pull\/(\d+)(?:\/|$)/);
	return match?.[1] ?? null;
}

function getStatusText(change: GitFileChange) {
	if (change.indexStatus !== ".") return change.indexStatus;
	if (change.worktreeStatus !== ".") return change.worktreeStatus;
	return "M";
}

function buildFileRows(gitState: GitState, scope: ChangeScope): FileRow[] {
	const rows = new Map<string, FileRow>();
	const add = (path: string, label: string, statusClassName: string, priority: number) => {
		if (shouldIgnoreGitPath(path)) return;
		const existing = rows.get(path);
		if (!existing || priority < existing.priority) {
			rows.set(path, { path, label, statusClassName, priority });
		}
	};

	for (const file of gitState.conflictedFiles) {
		add(file, "Conflict", "text-destructive", 0);
	}

	for (const change of gitState.unstagedChanges) {
		add(change.path, `Modified (${getStatusText(change)})`, "text-warning", 1);
	}

	for (const file of gitState.untrackedFiles) {
		add(file, "Untracked (?)", "text-info", 2);
	}

	if (scope === "full") {
		for (const change of gitState.stagedChanges) {
			add(change.path, `Staged (${getStatusText(change)})`, "text-success", 3);
		}
	}

	return Array.from(rows.values()).sort((a, b) => {
		if (a.priority !== b.priority) return a.priority - b.priority;
		return a.path.localeCompare(b.path);
	});
}

export function GitPanel({
	gitState,
	gitResult,
	gitDiff,
	workspaceOptions,
	sendGetGitStatus,
	sendGetGitDiff,
	sendGitCreateBranch,
	sendGitCommit,
	sendGitPush,
	sendGitCreatePr,
	clearGitResult,
}: GitPanelProps) {
	const pollPending = useRef(false);
	const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
	const diffTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
	const [pollError, setPollError] = useState<string | null>(null);
	const [changeScope, setChangeScope] = useState<ChangeScope>("working");
	const [showPrComposer, setShowPrComposer] = useState(false);
	const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
	const [diffCache, setDiffCache] = useState<Record<string, string>>({});
	const [diffErrors, setDiffErrors] = useState<Record<string, string>>({});
	const [loadingDiffs, setLoadingDiffs] = useState<Record<string, boolean>>({});
	const diffCacheRef = useRef<Record<string, string>>({});
	const loadingDiffsRef = useRef<Record<string, boolean>>({});
	const [latestPrUrl, setLatestPrUrl] = useState<string | null>(null);
	const [latestPrNumber, setLatestPrNumber] = useState<string | null>(null);
	const [selectedWorkspacePath, setSelectedWorkspacePath] = useState(
		workspaceOptions?.[0]?.workspacePath ?? ".",
	);

	const resolvedWorkspacePath = workspaceOptions?.length ? selectedWorkspacePath : undefined;
	const showWorkspaceSelector = (workspaceOptions?.length ?? 0) > 1;

	useEffect(() => {
		if (!workspaceOptions || workspaceOptions.length === 0) return;
		if (workspaceOptions.some((workspace) => workspace.workspacePath === selectedWorkspacePath)) {
			return;
		}
		setSelectedWorkspacePath(workspaceOptions[0].workspacePath);
	}, [workspaceOptions, selectedWorkspacePath]);

	const requestStatus = useCallback(() => {
		if (pollPending.current || !sendGetGitStatus) return;
		pollPending.current = true;
		sendGetGitStatus(resolvedWorkspacePath);
	}, [sendGetGitStatus, resolvedWorkspacePath]);

	const handleCreateBranch = useCallback(
		(branchName: string) => {
			sendGitCreateBranch?.(branchName, resolvedWorkspacePath);
		},
		[sendGitCreateBranch, resolvedWorkspacePath],
	);

	const handleCommit = useCallback(
		(message: string, opts?: { includeUntracked?: boolean; files?: string[] }) => {
			sendGitCommit?.(message, { ...opts, workspacePath: resolvedWorkspacePath });
		},
		[sendGitCommit, resolvedWorkspacePath],
	);

	const handlePush = useCallback(() => {
		sendGitPush?.(resolvedWorkspacePath);
	}, [sendGitPush, resolvedWorkspacePath]);

	const handleCreatePr = useCallback(
		(title: string, body?: string, baseBranch?: string) => {
			sendGitCreatePr?.(title, body, baseBranch, resolvedWorkspacePath);
		},
		[sendGitCreatePr, resolvedWorkspacePath],
	);

	useEffect(() => {
		if (gitState) {
			pollPending.current = false;
			setPollError(null);
		}
	}, [gitState]);

	useEffect(() => {
		if (gitResult) pollPending.current = false;
	}, [gitResult]);

	useEffect(() => {
		setLatestPrUrl(null);
		setLatestPrNumber(null);
		for (const timeout of diffTimeouts.current.values()) {
			clearTimeout(timeout);
		}
		diffTimeouts.current.clear();
		setExpandedFiles({});
		setDiffCache({});
		setDiffErrors({});
		setLoadingDiffs({});
	}, [resolvedWorkspacePath, changeScope]);

	useEffect(() => {
		diffCacheRef.current = diffCache;
	}, [diffCache]);

	useEffect(() => {
		loadingDiffsRef.current = loadingDiffs;
	}, [loadingDiffs]);

	useEffect(() => {
		requestStatus();
		pollInterval.current = setInterval(requestStatus, 5000);
		return () => {
			if (pollInterval.current) clearInterval(pollInterval.current);
		};
	}, [requestStatus]);

	useEffect(() => {
		if (!gitResult) return;

		if (gitResult.action === "get_status") {
			if (!gitResult.success) {
				setPollError(gitResult.message);
			} else {
				setPollError(null);
			}
			clearGitResult?.();
			return;
		}

		if (gitResult.success) setPollError(null);

		if (gitResult.success) {
			if (gitResult.prUrl) {
				setLatestPrUrl(gitResult.prUrl);
				setLatestPrNumber(getPullRequestNumberFromUrl(gitResult.prUrl));
				toast.success("Pull request created", {
					action: {
						label: "Open",
						onClick: () => window.open(gitResult.prUrl, "_blank"),
					},
				});
			} else {
				toast.success(gitResult.message);
			}
		} else {
			const quietCodes = ["NOTHING_TO_COMMIT", "NO_REMOTE", "MULTIPLE_REMOTES", "BRANCH_EXISTS"];
			if (quietCodes.includes(gitResult.code)) {
				toast.info(gitResult.message);
			} else {
				toast.error(gitResult.message);
			}
		}

		clearGitResult?.();
	}, [gitResult, clearGitResult]);

	useEffect(() => {
		if (!gitDiff) return;
		const key = `${gitDiff.scope}:${gitDiff.path}`;
		const pendingTimeout = diffTimeouts.current.get(key);
		if (pendingTimeout) {
			clearTimeout(pendingTimeout);
			diffTimeouts.current.delete(key);
		}
		setLoadingDiffs((prev) => ({ ...prev, [key]: false }));
		if (gitDiff.success && gitDiff.patch) {
			setDiffCache((prev) => ({ ...prev, [key]: gitDiff.patch || "" }));
			setDiffErrors((prev) => {
				if (!prev[key]) return prev;
				const next = { ...prev };
				delete next[key];
				return next;
			});
		} else if (!gitDiff.success || gitDiff.message) {
			setDiffErrors((prev) => ({ ...prev, [key]: gitDiff.message || "Failed to load diff" }));
		}
	}, [gitDiff]);

	useEffect(() => {
		return () => {
			for (const timeout of diffTimeouts.current.values()) {
				clearTimeout(timeout);
			}
			diffTimeouts.current.clear();
		};
	}, []);

	const isBusy = gitState?.isBusy || gitState?.rebaseInProgress || gitState?.mergeInProgress;
	const canMutate = !!gitState && !isBusy;

	const fileRows = useMemo(() => {
		if (!gitState) return [];
		return buildFileRows(gitState, changeScope);
	}, [gitState, changeScope]);

	const diffScope: "unstaged" | "staged" | "full" = changeScope === "working" ? "unstaged" : "full";

	const toggleFileDiff = useCallback(
		(path: string) => {
			const key = `${diffScope}:${path}`;
			const nextValue = !expandedFiles[path];
			setExpandedFiles((prev) => ({ ...prev, [path]: nextValue }));
			if (!nextValue || !sendGetGitDiff) return;
			if (diffCacheRef.current[key] || loadingDiffsRef.current[key]) return;

			setLoadingDiffs((loadingPrev) => ({ ...loadingPrev, [key]: true }));
			const existingTimeout = diffTimeouts.current.get(key);
			if (existingTimeout) {
				clearTimeout(existingTimeout);
			}
			const timeout = setTimeout(() => {
				setLoadingDiffs((loadingPrev) => ({ ...loadingPrev, [key]: false }));
				setDiffErrors((errorPrev) => {
					if (diffCacheRef.current[key]) return errorPrev;
					return {
						...errorPrev,
						[key]:
							errorPrev[key] ||
							"Diff request timed out. Try collapsing and expanding this file again.",
					};
				});
				diffTimeouts.current.delete(key);
			}, 12_000);
			diffTimeouts.current.set(key, timeout);
			sendGetGitDiff(path, diffScope, resolvedWorkspacePath);
		},
		[diffScope, expandedFiles, resolvedWorkspacePath, sendGetGitDiff],
	);

	return (
		<PanelShell title="Git" icon={<GitBranch className="h-4 w-4" />} noPadding>
			{!gitState ? (
				<div className="flex items-center justify-center h-full">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : (
				<div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
					{showWorkspaceSelector && workspaceOptions && (
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Workspace
							</p>
							<Select value={selectedWorkspacePath} onValueChange={setSelectedWorkspacePath}>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{workspaceOptions.map((workspace) => (
										<SelectItem
											key={workspace.workspacePath}
											value={workspace.workspacePath}
											className="text-xs"
										>
											{workspace.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					<GitTopBar
						gitState={gitState}
						fileCount={fileRows.length}
						latestPrUrl={latestPrUrl}
						latestPrNumber={latestPrNumber}
						canMutate={canMutate}
						onCreateBranch={handleCreateBranch}
						onRefresh={requestStatus}
						onOpenPrComposer={() => setShowPrComposer(true)}
					/>

					{pollError && (
						<div className="text-xs text-muted-foreground">Last update failed: {pollError}</div>
					)}

					<BusyAndStatusWarnings gitState={gitState} />

					<ChangesFirstSection
						fileRows={fileRows}
						changeScope={changeScope}
						onChangeScope={setChangeScope}
						diffScope={diffScope}
						expandedFiles={expandedFiles}
						diffCache={diffCache}
						diffErrors={diffErrors}
						loadingDiffs={loadingDiffs}
						onToggleFileDiff={toggleFileDiff}
					/>

					<CommitSection gitState={gitState} canMutate={canMutate} sendGitCommit={handleCommit} />

					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<PushSection gitState={gitState} canMutate={canMutate} sendGitPush={handlePush} />
						<PrSection
							gitState={gitState}
							canMutate={canMutate}
							sendGitCreatePr={handleCreatePr}
							showForm={showPrComposer}
							onShowFormChange={setShowPrComposer}
						/>
					</div>

					<CommitsSection gitState={gitState} />
				</div>
			)}
		</PanelShell>
	);
}

function GitTopBar({
	gitState,
	fileCount,
	latestPrUrl,
	latestPrNumber,
	canMutate,
	onCreateBranch,
	onRefresh,
	onOpenPrComposer,
}: {
	gitState: GitState;
	fileCount: number;
	latestPrUrl: string | null;
	latestPrNumber: string | null;
	canMutate: boolean;
	onCreateBranch?: (name: string) => void;
	onRefresh: () => void;
	onOpenPrComposer: () => void;
}) {
	const [showBranchInput, setShowBranchInput] = useState(false);
	const [branchName, setBranchName] = useState("");

	const handleCreateBranch = () => {
		const nextBranch = branchName.trim();
		if (!nextBranch || !onCreateBranch) return;
		onCreateBranch(nextBranch);
		setBranchName("");
		setShowBranchInput(false);
	};

	const aheadBehindText =
		gitState.ahead === null && gitState.behind === null
			? gitState.isShallow
				? "Shallow clone"
				: "No upstream"
			: `${gitState.ahead ?? 0} ahead / ${gitState.behind ?? 0} behind`;
	const positiveCount =
		gitState.untrackedFiles.length +
		gitState.unstagedChanges.filter((change) =>
			[change.indexStatus, change.worktreeStatus].includes("A"),
		).length +
		gitState.stagedChanges.filter((change) =>
			[change.indexStatus, change.worktreeStatus].includes("A"),
		).length;
	const negativeCount =
		gitState.unstagedChanges.filter((change) =>
			[change.indexStatus, change.worktreeStatus].includes("D"),
		).length +
		gitState.stagedChanges.filter((change) =>
			[change.indexStatus, change.worktreeStatus].includes("D"),
		).length;

	const persistedPrUrl = gitState.openPrUrl ?? null;
	const persistedPrNumber = gitState.openPrNumber?.toString() ?? null;
	const effectivePrUrl = latestPrUrl || persistedPrUrl;
	const effectivePrNumber = latestPrNumber || persistedPrNumber;

	return (
		<div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 -mx-3 px-3">
			<div className="flex min-h-11 items-center gap-2 py-1.5">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<div className="flex min-w-0 items-center gap-2">
						<GitBranch className="h-4 w-4 shrink-0 text-success" />
						<span className="shrink-0 text-sm font-medium">
							{effectivePrNumber ? `#${effectivePrNumber}` : `#${fileCount}`}
						</span>
						<div className="ml-1 flex items-center gap-1.5">
							<p className="text-sm font-medium text-success">+{positiveCount}</p>
							<p className="text-sm font-medium text-destructive">-{negativeCount}</p>
						</div>
					</div>
					<div className="hidden items-center gap-1 md:flex">
						<span className="max-w-44 truncate text-sm font-medium text-foreground">
							{gitState.branch || "unknown"}
						</span>
						{gitState.detached && <span className="text-xs text-destructive">(detached)</span>}
					</div>
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{effectivePrUrl && (
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs hidden sm:inline-flex"
							onClick={() => window.open(effectivePrUrl, "_blank")}
						>
							View PR
						</Button>
					)}
					<Button
						variant="outline"
						size="icon"
						className="h-7 w-7"
						onClick={onRefresh}
						title="Refresh"
					>
						<RefreshCcw className="h-3.5 w-3.5" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs hidden sm:inline-flex"
						disabled={!canMutate || gitState.detached}
						onClick={onOpenPrComposer}
					>
						<GitPullRequest className="h-3 w-3 mr-1.5" />
						Create PR
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						disabled={!canMutate}
						onClick={() => setShowBranchInput((prev) => !prev)}
					>
						<Plus className="h-3 w-3 mr-1.5" />
						Branch
					</Button>
				</div>
			</div>
			<div className="pb-1 text-xs text-muted-foreground">{aheadBehindText}</div>
			{showBranchInput && (
				<div className="flex items-center gap-1.5 pb-2">
					<Input
						value={branchName}
						onChange={(event) => setBranchName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") handleCreateBranch();
							if (event.key === "Escape") setShowBranchInput(false);
						}}
						placeholder="feature/new-branch"
						className="h-7 text-xs"
						autoFocus
					/>
					<Button
						variant="primary"
						size="sm"
						className="h-7 text-xs px-2"
						disabled={!branchName.trim()}
						onClick={handleCreateBranch}
					>
						Create
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2"
						onClick={() => setShowBranchInput(false)}
					>
						<X className="h-3 w-3" />
					</Button>
				</div>
			)}
		</div>
	);
}

function BusyAndStatusWarnings({ gitState }: { gitState: GitState }) {
	const warnings: string[] = [];
	if (gitState.isBusy) warnings.push("Git is busy (index.lock)");
	if (gitState.rebaseInProgress) warnings.push("Rebase in progress");
	if (gitState.mergeInProgress) warnings.push("Merge in progress");

	if (warnings.length === 0 && !gitState.isShallow) return null;

	return (
		<div className="space-y-1">
			{gitState.isShallow && (
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<AlertTriangle className="h-3 w-3 shrink-0" />
					<span>Shallow clone (limited history)</span>
				</div>
			)}
			{warnings.map((warning) => (
				<div key={warning} className="flex items-center gap-1.5 text-xs text-destructive">
					<AlertTriangle className="h-3 w-3 shrink-0" />
					<span>{warning}</span>
				</div>
			))}
		</div>
	);
}

function getDiffStats(patch: string): { additions: number; deletions: number; lines: string[] } {
	const lines = patch.split("\n");
	let additions = 0;
	let deletions = 0;

	for (const line of lines) {
		if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
		if (line.startsWith("+")) additions += 1;
		if (line.startsWith("-")) deletions += 1;
	}

	return { additions, deletions, lines };
}

type ParsedDiffRow =
	| { kind: "add"; oldLine: null; newLine: number; content: string }
	| { kind: "del"; oldLine: number; newLine: null; content: string }
	| { kind: "context"; oldLine: number; newLine: number; content: string }
	| { kind: "hunk"; content: string };

type RenderRow = ParsedDiffRow | { kind: "omitted"; count: number };

function parseDiffRows(patch: string): ParsedDiffRow[] {
	const rows: ParsedDiffRow[] = [];
	const lines = patch.split("\n");
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;

	for (const line of lines) {
		if (
			line.startsWith("diff --git ") ||
			line.startsWith("index ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ")
		) {
			continue;
		}

		const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunkMatch) {
			oldLine = Number.parseInt(hunkMatch[1], 10);
			newLine = Number.parseInt(hunkMatch[2], 10);
			inHunk = true;
			rows.push({ kind: "hunk", content: line });
			continue;
		}

		if (!inHunk) continue;
		if (line === "\\ No newline at end of file") continue;

		if (line.startsWith("+")) {
			rows.push({ kind: "add", oldLine: null, newLine, content: line.slice(1) });
			newLine += 1;
			continue;
		}
		if (line.startsWith("-")) {
			rows.push({ kind: "del", oldLine, newLine: null, content: line.slice(1) });
			oldLine += 1;
			continue;
		}

		const content = line.startsWith(" ") ? line.slice(1) : line;
		rows.push({ kind: "context", oldLine, newLine, content });
		oldLine += 1;
		newLine += 1;
	}

	return rows;
}

function compactContextRows(rows: ParsedDiffRow[], keepEdgeLines = 2): RenderRow[] {
	const output: RenderRow[] = [];
	let index = 0;

	while (index < rows.length) {
		const row = rows[index];
		if (row.kind !== "context") {
			output.push(row);
			index += 1;
			continue;
		}

		let end = index;
		while (end < rows.length && rows[end]?.kind === "context") {
			end += 1;
		}

		const run = rows.slice(index, end) as Array<Extract<ParsedDiffRow, { kind: "context" }>>;
		if (run.length <= keepEdgeLines * 2 + 2) {
			output.push(...run);
		} else {
			output.push(...run.slice(0, keepEdgeLines));
			output.push({ kind: "omitted", count: run.length - keepEdgeLines * 2 });
			output.push(...run.slice(-keepEdgeLines));
		}
		index = end;
	}

	return output;
}

function DiffContent({ patch }: { patch: string }) {
	const parsed = parseDiffRows(patch);
	if (parsed.length === 0) {
		return (
			<div className="rounded-md border border-border/70 bg-muted/20 overflow-x-auto">
				<pre className="text-[12px] leading-6 whitespace-pre min-w-full p-2 text-foreground">
					{patch}
				</pre>
			</div>
		);
	}
	const rows = compactContextRows(parsed, 0);

	const renderLineNumber = (value: number | null) => (
		<span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
			{value ?? ""}
		</span>
	);

	return (
		<div className="rounded-md border border-border/70 bg-muted/20 overflow-x-auto">
			<div className="min-w-full p-2 font-mono text-[12px] leading-6">
				{rows.map((row, index) => {
					if (row.kind === "omitted") {
						return (
							<div
								key={`omitted-${index}`}
								className="mx-1 my-1 rounded-md border border-border/60 bg-background px-3 py-1 text-[11px] text-muted-foreground"
							>
								{row.count} unmodified lines
							</div>
						);
					}

					if (row.kind === "hunk") {
						return null;
					}

					const rowClassName =
						row.kind === "add"
							? "border-l-2 border-l-success bg-success/10 text-foreground"
							: row.kind === "del"
								? "border-l-2 border-l-destructive bg-destructive/10 text-foreground"
								: "text-foreground";
					const displayLine = row.oldLine ?? row.newLine;

					return (
						<div
							key={`line-${index}`}
							className={`grid grid-cols-[2.6rem_minmax(0,1fr)] items-center gap-2 px-2 ${rowClassName}`}
						>
							{renderLineNumber(displayLine)}
							<span className="whitespace-pre overflow-x-auto">{row.content || " "}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ChangesFirstSection({
	fileRows,
	changeScope,
	onChangeScope,
	diffScope,
	expandedFiles,
	diffCache,
	diffErrors,
	loadingDiffs,
	onToggleFileDiff,
}: {
	fileRows: FileRow[];
	changeScope: ChangeScope;
	onChangeScope: (scope: ChangeScope) => void;
	diffScope: "unstaged" | "staged" | "full";
	expandedFiles: Record<string, boolean>;
	diffCache: Record<string, string>;
	diffErrors: Record<string, string>;
	loadingDiffs: Record<string, boolean>;
	onToggleFileDiff: (path: string) => void;
}) {
	const scopeCount = fileRows.length;

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div>
					<p className="text-sm font-medium">Changed files</p>
					<p className="text-xs text-muted-foreground">{scopeCount} visible in this view</p>
				</div>
				<div className="inline-flex rounded-md border border-border bg-background p-0.5">
					<Button
						variant={changeScope === "working" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 px-2 text-[11px]"
						onClick={() => onChangeScope("working")}
					>
						Working tree
					</Button>
					<Button
						variant={changeScope === "full" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 px-2 text-[11px]"
						onClick={() => onChangeScope("full")}
					>
						Full PR
					</Button>
				</div>
			</div>

			{fileRows.length === 0 ? (
				<div className="text-xs text-muted-foreground">No file changes in this scope.</div>
			) : (
				<div className="space-y-2">
					{fileRows.map((row) => {
						const key = `${diffScope}:${row.path}`;
						const expanded = !!expandedFiles[row.path];
						const patch = diffCache[key];
						const error = diffErrors[key];
						const loading = !!loadingDiffs[key];
						const diffStats = patch ? getDiffStats(patch) : null;

						return (
							<div key={row.path} className="rounded-lg border border-border/60 bg-background">
								<Button
									variant="ghost"
									size="sm"
									className="h-auto w-full rounded-none px-2 py-1.5"
									onClick={() => onToggleFileDiff(row.path)}
								>
									<div className="flex w-full items-center justify-start gap-3 pr-3 pl-0.5">
										<ChevronDown
											className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
												expanded ? "rotate-0" : "-rotate-90"
											}`}
										/>
										<div className="flex min-w-0 flex-1 items-center justify-start gap-1">
											<FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span dir="rtl" className="truncate text-sm font-medium text-foreground">
												{row.path}
											</span>
										</div>
										<div className="flex shrink-0 items-center gap-1.5">
											{diffStats ? (
												<>
													<p className="text-sm font-medium text-success">+{diffStats.additions}</p>
													<p className="text-sm font-medium text-destructive">
														-{diffStats.deletions}
													</p>
												</>
											) : (
												<span className={`text-xs ${row.statusClassName}`}>{row.label}</span>
											)}
										</div>
									</div>
								</Button>
								{expanded && (
									<div className="w-full border-t border-border/40 px-2 py-2">
										{loading ? (
											<p className="text-xs text-muted-foreground">Loading diff...</p>
										) : error ? (
											<p className="text-xs text-muted-foreground">{error}</p>
										) : patch ? (
											<DiffContent patch={patch} />
										) : (
											<p className="text-xs text-muted-foreground">No diff available.</p>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function CommitSection({
	gitState,
	canMutate,
	sendGitCommit,
}: {
	gitState: GitState;
	canMutate: boolean;
	sendGitCommit?: (
		message: string,
		opts?: { includeUntracked?: boolean; files?: string[] },
	) => void;
}) {
	const [message, setMessage] = useState("");
	const [includeUntracked, setIncludeUntracked] = useState(false);

	const hasChanges =
		gitState.stagedChanges.length > 0 ||
		gitState.unstagedChanges.length > 0 ||
		(includeUntracked && gitState.untrackedFiles.length > 0);

	const hasConflicts = gitState.conflictedFiles.length > 0;

	const handleCommit = () => {
		const nextMessage = message.trim();
		if (!nextMessage || !sendGitCommit) return;
		sendGitCommit(nextMessage, { includeUntracked });
		setMessage("");
	};

	return (
		<div className="rounded-lg border border-border bg-card p-3 space-y-2">
			<p className="text-sm font-medium">Commit</p>
			<Input
				value={message}
				onChange={(event) => setMessage(event.target.value)}
				placeholder="Commit message"
				className="h-7 text-xs"
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) handleCommit();
				}}
			/>
			{gitState.untrackedFiles.length > 0 && (
				<Label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
					<Checkbox
						checked={includeUntracked}
						onCheckedChange={(value) => setIncludeUntracked(value === true)}
						className="h-3.5 w-3.5"
					/>
					Include untracked files
				</Label>
			)}
			<Button
				variant="primary"
				size="sm"
				className="w-full h-7 text-xs"
				onClick={handleCommit}
				disabled={!canMutate || !message.trim() || !hasChanges || hasConflicts}
			>
				<GitCommit className="h-3 w-3 mr-1.5" />
				Commit changes
			</Button>
		</div>
	);
}

function PushSection({
	gitState,
	canMutate,
	sendGitPush,
}: {
	gitState: GitState;
	canMutate: boolean;
	sendGitPush?: () => void;
}) {
	const canPush = canMutate && !gitState.detached;
	const upToDate = gitState.ahead === 0 && gitState.behind === 0;
	const isBehind = gitState.behind !== null && gitState.behind > 0;

	return (
		<div className="rounded-lg border border-border bg-card p-3 space-y-2">
			<p className="text-sm font-medium">Push</p>
			{gitState.detached ? (
				<div className="text-xs text-muted-foreground">Cannot push from detached HEAD</div>
			) : upToDate ? (
				<div className="text-xs text-muted-foreground">Up to date with remote</div>
			) : (
				<>
					{isBehind && (
						<div className="text-xs text-destructive">
							Behind remote by {gitState.behind} commit{gitState.behind !== 1 ? "s" : ""}.
						</div>
					)}
					<Button
						variant="outline"
						size="sm"
						className="w-full h-7 text-xs"
						onClick={() => sendGitPush?.()}
						disabled={!canPush}
					>
						<Upload className="h-3 w-3 mr-1.5" />
						{gitState.ahead !== null && gitState.ahead > 0
							? `Push ${gitState.ahead} commit${gitState.ahead !== 1 ? "s" : ""}`
							: "Push"}
					</Button>
				</>
			)}
		</div>
	);
}

function PrSection({
	gitState,
	canMutate,
	sendGitCreatePr,
	showForm,
	onShowFormChange,
}: {
	gitState: GitState;
	canMutate: boolean;
	sendGitCreatePr?: (title: string, body?: string, baseBranch?: string) => void;
	showForm: boolean;
	onShowFormChange: (show: boolean) => void;
}) {
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [baseBranch, setBaseBranch] = useState("");

	if (gitState.detached) {
		return (
			<div className="rounded-lg border border-border bg-card p-3">
				<p className="text-sm font-medium">Pull Request</p>
				<p className="mt-2 text-xs text-muted-foreground">Not available in detached HEAD.</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card p-3 space-y-2">
			<p className="text-sm font-medium">Pull Request</p>
			{!showForm ? (
				<Button
					variant="outline"
					size="sm"
					className="w-full h-7 text-xs"
					disabled={!canMutate}
					onClick={() => onShowFormChange(true)}
				>
					<GitPullRequest className="h-3 w-3 mr-1.5" />
					Open PR form
				</Button>
			) : (
				<>
					<Input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="PR title"
						className="h-7 text-xs"
					/>
					<Textarea
						value={body}
						onChange={(event) => setBody(event.target.value)}
						placeholder="Description (optional)"
						className="text-xs min-h-[60px]"
						rows={3}
					/>
					<Input
						value={baseBranch}
						onChange={(event) => setBaseBranch(event.target.value)}
						placeholder="Base branch (default: repo default)"
						className="h-7 text-xs"
					/>
					<div className="flex items-center gap-1.5">
						<Button
							variant="outline"
							size="sm"
							className="flex-1 h-7 text-xs"
							disabled={!canMutate || !title.trim()}
							onClick={() => {
								sendGitCreatePr?.(
									title.trim(),
									body.trim() || undefined,
									baseBranch.trim() || undefined,
								);
								onShowFormChange(false);
							}}
						>
							<GitPullRequest className="h-3 w-3 mr-1.5" />
							Create PR
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2"
							onClick={() => onShowFormChange(false)}
						>
							<X className="h-3 w-3" />
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

function CommitsSection({ gitState }: { gitState: GitState }) {
	if (gitState.commits.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-card p-3 space-y-2">
			<p className="text-sm font-medium">Recent commits</p>
			<div className="space-y-1">
				{gitState.commits.slice(0, 8).map((commit) => (
					<div key={commit.sha} className="flex items-start gap-1.5 text-xs">
						<span className="font-mono text-muted-foreground shrink-0">
							{commit.sha.slice(0, 7)}
						</span>
						<span className="truncate">{commit.message}</span>
					</div>
				))}
			</div>
		</div>
	);
}
