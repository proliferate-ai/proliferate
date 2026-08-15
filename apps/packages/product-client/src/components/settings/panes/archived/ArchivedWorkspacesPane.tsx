import { Archive, Search } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { SettingsGroup } from "#product/primitives/patterns/settings/SettingsGroup";
import { SettingsMenu } from "#product/primitives/patterns/settings/SettingsMenu";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { ArchivedWorkspaceRow } from "#product/components/settings/panes/archived/ArchivedWorkspaceRow";
import { UnarchiveScenarioDialog } from "#product/components/settings/panes/archived/UnarchiveScenarioDialog";
import { useArchivedWorkspacesPageActions } from "#product/hooks/workspaces/workflows/use-archived-workspaces-page-actions";
import { workspaceDisplayName } from "#product/lib/domain/workspaces/display/workspace-display";

const PURGE_COPY_SUFFIX =
  " This permanently deletes chat history, including the raw agent transcripts, and cannot be undone.";

/**
 * The Archived workspaces settings page (§3.6): list, search, sort, per-row
 * unarchive/delete and Delete all. It holds no preferences — the archive
 * knobs live where preferences live ("Delete branch on archive" on the
 * General tab, the two repo-scoped knobs on the Repo tab per §3.12). All
 * state and workflow live in the paired hook; this component renders and
 * forwards.
 */
export function ArchivedWorkspacesPane() {
  const {
    isLoading,
    workspaces,
    repoRoots,
    hasAnyArchived,
    hasSearchMatches,
    search,
    setSearch,
    sort,
    setSort,
    sortOptions,
    exitingIds,
    requestUnarchive,
    requestDelete,
    requestDeleteAll,
    cancelDelete,
    confirmDelete,
    deleteTarget,
    deleteTargetWorkspace,
    deleteAllCount,
    isDeleting,
    scenario,
    dismissScenario,
    onScenarioConfirm,
  } = useArchivedWorkspacesPageActions();

  if (isLoading) {
    return <SettingsPageBody />;
  }

  return (
    <SettingsPageBody>
      {hasAnyArchived ? (
        <>
          <PageHeader
            variant="flat"
            title="Archived workspaces"
            description="Workspaces you've archived. Chat history stays available until you delete them."
            actions={(
              <Button type="button" variant="destructive" size="sm" onClick={requestDeleteAll}>
                Delete all
              </Button>
            )}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 icon-paired -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search archived workspaces"
                aria-label="Search archived workspaces"
                className="pl-9"
              />
            </div>
            <SettingsMenu
              label={sortOptions.find((option) => option.id === sort)?.label ?? "Sort"}
              groups={[{
                id: "sort",
                label: "Sort by",
                options: sortOptions.map((option) => ({
                  id: option.id,
                  label: option.label,
                  selected: option.id === sort,
                  onSelect: () => setSort(option.id),
                })),
              }]}
            />
          </div>
        </>
      ) : null}

      {hasAnyArchived ? (
        <SettingsGroup
          empty={hasSearchMatches ? undefined : `No archived workspaces match "${search}"`}
        >
          {workspaces.map((workspace) => (
            <ArchivedWorkspaceRow
              key={workspace.id}
              workspace={workspace}
              repoRoots={repoRoots}
              sort={sort}
              exiting={exitingIds.has(workspace.id)}
              onUnarchive={requestUnarchive}
              onDelete={requestDelete}
            />
          ))}
        </SettingsGroup>
      ) : (
        <SettingsEmptyState
          icon={<Archive />}
          title="No archived workspaces"
          description="Workspaces you archive from the sidebar show up here."
        />
      )}

      <ConfirmationDialog
        open={deleteTarget !== null}
        title="Delete permanently?"
        description={deleteTarget === "all"
          ? `This deletes all ${deleteAllCount} archived workspace${deleteAllCount === 1 ? "" : "s"}.${PURGE_COPY_SUFFIX}`
          : `This deletes "${deleteTargetWorkspace ? workspaceDisplayName(deleteTargetWorkspace) : "this workspace"}".${PURGE_COPY_SUFFIX}`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={isDeleting}
        onClose={cancelDelete}
        onConfirm={() => void confirmDelete()}
      />

      <UnarchiveScenarioDialog
        state={scenario}
        onCancel={dismissScenario}
        onConfirm={onScenarioConfirm}
      />
    </SettingsPageBody>
  );
}
