import { useMemo, useState } from "react";
import { Search } from "@proliferate/ui/icons";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistryEntry,
} from "@/config/harness-env-vars";

interface ProviderPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** The provider whose first env var seeds a new api-key row (contract §7). */
  onSelect: (provider: ProviderRegistryEntry) => void;
}

/**
 * Searchable list over the vendored provider registry (contract §6), styled
 * like OpenCode's own provider picker. Selecting a provider prefills the new
 * row's env_var_name + provider_hint; providers without a known env var are
 * omitted (there is nothing to prefill).
 */
export function ProviderPickerModal({
  open,
  onClose,
  onSelect,
}: ProviderPickerModalProps) {
  const [search, setSearch] = useState("");

  const providers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return PROVIDER_REGISTRY.filter(
      (provider) => provider.envVarNames.length > 0,
    ).filter((provider) => {
      if (!query) {
        return true;
      }
      return (
        provider.displayName.toLowerCase().includes(query)
        || provider.id.toLowerCase().includes(query)
      );
    });
  }, [search]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Add provider"
      description="Pick a provider to wire one of your own keys into OpenCode."
      bodyClassName="px-5 pb-5 pt-2"
    >
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search providers"
            placeholder="Search providers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {providers.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No providers match your search.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {providers.map((provider) => (
                <li key={provider.id}>
                  <PopoverMenuItem
                    label={provider.displayName}
                    labelClassName="font-medium"
                    onClick={() => {
                      onSelect(provider);
                      onClose();
                    }}
                  >
                    <span className="font-mono">{provider.envVarNames[0]}</span>
                  </PopoverMenuItem>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
