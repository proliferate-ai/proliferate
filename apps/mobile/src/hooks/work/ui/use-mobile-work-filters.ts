import { useMemo, useState } from "react";
import type {
  CloudWorkFilters,
  CloudWorkOwnerFilter,
  CloudWorkSort,
  RecentWorkRuntimeLocation,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import type { MobileWorkItem } from "../derived/use-mobile-work-inventory";
import {
  semanticSourcesForMobileWorkType,
  type MobileWorkRuntimeFilter,
  type MobileWorkStatusFilter,
  type MobileWorkTypeFilter,
} from "../../../lib/domain/work/mobile-work-filters";

export function useMobileWorkFilters(allItems: readonly MobileWorkItem[]) {
  const [workType, setWorkType] = useState<MobileWorkTypeFilter>("all");
  const [runtime, setRuntime] = useState<MobileWorkRuntimeFilter>("all");
  const [ownership, setOwnership] = useState<CloudWorkOwnerFilter>("all");
  const [status, setStatus] = useState<MobileWorkStatusFilter>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [repo, setRepo] = useState("all");
  const [sort, setSort] = useState<CloudWorkSort>("recent");

  const filters = useMemo<CloudWorkFilters>(() => ({
    ownership,
    semanticSources: semanticSourcesForMobileWorkType(workType),
    runtimeLocations: runtime === "all" ? undefined : new Set<RecentWorkRuntimeLocation>([runtime]),
    statuses: status === "all" ? undefined : new Set([status]),
    repoLabels: repo === "all" ? undefined : new Set<string>([repo]),
    sort,
    needsAttention: attentionOnly,
  }), [attentionOnly, ownership, repo, runtime, sort, status, workType]);

  const repoOptions = useMemo(() => {
    return [...new Set(allItems.map((item) => item.view.repoLabel))]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }, [allItems]);

  const activeFilterCount = [
    workType !== "all",
    runtime !== "all",
    ownership !== "all",
    status !== "all",
    repo !== "all",
    sort !== "recent",
    attentionOnly,
  ].filter(Boolean).length;

  function clearFilters() {
    setWorkType("all");
    setRuntime("all");
    setOwnership("all");
    setStatus("all");
    setRepo("all");
    setSort("recent");
    setAttentionOnly(false);
  }

  return {
    activeFilterCount,
    attentionOnly,
    clearFilters,
    filters,
    ownership,
    repo,
    repoOptions,
    runtime,
    setAttentionOnly,
    setOwnership,
    setRepo,
    setRuntime,
    setSort,
    setStatus,
    setWorkType,
    sort,
    status,
    workType,
  };
}
