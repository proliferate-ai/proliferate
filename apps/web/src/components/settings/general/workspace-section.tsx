"use client";

import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { organization } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil } from "lucide-react";
import { useState } from "react";

interface WorkspaceSectionProps {
	activeOrg: {
		id: string;
		name: string;
		slug: string;
	};
	isOwner: boolean;
}

export function WorkspaceSection({ activeOrg, isOwner }: WorkspaceSectionProps) {
	const queryClient = useQueryClient();

	const [isEditingName, setIsEditingName] = useState(false);
	const [editedName, setEditedName] = useState("");
	const [isUpdatingName, setIsUpdatingName] = useState(false);

	const [isEditingSlug, setIsEditingSlug] = useState(false);
	const [editedSlug, setEditedSlug] = useState("");
	const [isUpdatingSlug, setIsUpdatingSlug] = useState(false);
	const [slugError, setSlugError] = useState<string | null>(null);

	const [copiedId, setCopiedId] = useState(false);

	const handleStartEditName = () => {
		setEditedName(activeOrg.name || "");
		setIsEditingName(true);
	};

	const handleSaveName = async () => {
		if (!editedName.trim() || editedName === activeOrg.name) {
			setIsEditingName(false);
			return;
		}
		setIsUpdatingName(true);
		try {
			await organization.update({
				organizationId: activeOrg.id,
				data: { name: editedName.trim() },
			});
			window.location.reload();
		} catch (error) {
			console.error("Failed to update organization name:", error);
		} finally {
			setIsUpdatingName(false);
			setIsEditingName(false);
		}
	};

	const handleStartEditSlug = () => {
		setEditedSlug(activeOrg.slug || "");
		setSlugError(null);
		setIsEditingSlug(true);
	};

	const handleSaveSlug = async () => {
		const sanitizedSlug = editedSlug
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");

		if (!sanitizedSlug || sanitizedSlug === activeOrg.slug) {
			setIsEditingSlug(false);
			return;
		}
		if (sanitizedSlug.length < 3) {
			setSlugError("Slug must be at least 3 characters");
			return;
		}
		setIsUpdatingSlug(true);
		setSlugError(null);
		try {
			await organization.update({
				organizationId: activeOrg.id,
				data: { slug: sanitizedSlug },
			});
			queryClient.invalidateQueries({ queryKey: ["organizations"] });
			setIsEditingSlug(false);
		} catch (error: any) {
			console.error("Failed to update organization slug:", error);
			if (error?.message?.includes("unique") || error?.message?.includes("exists")) {
				setSlugError("This slug is already taken");
			} else {
				setSlugError("Failed to update slug");
			}
		} finally {
			setIsUpdatingSlug(false);
		}
	};

	const handleCopyId = () => {
		navigator.clipboard.writeText(activeOrg.id);
		setCopiedId(true);
		setTimeout(() => setCopiedId(false), 2000);
	};

	return (
		<SettingsSection title="Workspace">
			<SettingsCard>
				<SettingsRow label="Name" description="The display name for your workspace">
					{isEditingName ? (
						<div className="flex items-center gap-2">
							<Input
								value={editedName}
								onChange={(e) => setEditedName(e.target.value)}
								className="w-40 h-8 text-sm"
								autoFocus
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSaveName();
									if (e.key === "Escape") setIsEditingName(false);
								}}
							/>
							<Button size="sm" className="h-7" onClick={handleSaveName} disabled={isUpdatingName}>
								{isUpdatingName ? "..." : "Save"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								className="h-7"
								onClick={() => setIsEditingName(false)}
							>
								Cancel
							</Button>
						</div>
					) : (
						<div className="flex items-center gap-1.5">
							<span className="text-sm">{activeOrg.name}</span>
							{isOwner && (
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 text-muted-foreground hover:text-foreground"
									onClick={handleStartEditName}
								>
									<Pencil className="h-3 w-3" />
								</Button>
							)}
						</div>
					)}
				</SettingsRow>
				<SettingsRow label="Slug" description="Used in URLs and API identifiers">
					{isEditingSlug ? (
						<div className="flex flex-col items-end gap-1">
							<div className="flex items-center gap-2">
								<Input
									value={editedSlug}
									onChange={(e) => {
										setEditedSlug(e.target.value);
										setSlugError(null);
									}}
									className="w-40 h-8 text-sm font-mono"
									autoFocus
									onKeyDown={(e) => {
										if (e.key === "Enter") handleSaveSlug();
										if (e.key === "Escape") setIsEditingSlug(false);
									}}
								/>
								<Button
									size="sm"
									className="h-7"
									onClick={handleSaveSlug}
									disabled={isUpdatingSlug}
								>
									{isUpdatingSlug ? "..." : "Save"}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="h-7"
									onClick={() => setIsEditingSlug(false)}
								>
									Cancel
								</Button>
							</div>
							{slugError && <span className="text-xs text-destructive">{slugError}</span>}
						</div>
					) : (
						<div className="flex items-center gap-1.5">
							<code className="text-xs bg-muted/70 px-2 py-1 rounded font-mono">
								{activeOrg.slug}
							</code>
							{isOwner && (
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 text-muted-foreground hover:text-foreground"
									onClick={handleStartEditSlug}
								>
									<Pencil className="h-3 w-3" />
								</Button>
							)}
						</div>
					)}
				</SettingsRow>
				<SettingsRow label="ID" description="Unique identifier for API usage">
					<div className="flex items-center gap-1.5">
						<code className="text-xs bg-muted/70 px-2 py-1 rounded font-mono truncate max-w-36">
							{activeOrg.id}
						</code>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground hover:text-foreground"
							onClick={handleCopyId}
						>
							<Copy className="h-3 w-3" />
						</Button>
						{copiedId && <span className="text-xs text-muted-foreground">Copied!</span>}
					</div>
				</SettingsRow>
			</SettingsCard>
		</SettingsSection>
	);
}
