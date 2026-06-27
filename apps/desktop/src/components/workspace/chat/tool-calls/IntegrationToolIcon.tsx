import { Settings } from "@proliferate/ui/icons";
import { PluginInlineIcon } from "@proliferate/product-ui/plugins/PluginGlyph";

export function IntegrationToolIcon({ iconId }: { iconId: string | null }) {
  if (!iconId) {
    return <Settings className="size-3 text-faint" />;
  }

  return (
    <PluginInlineIcon
      iconId={iconId}
      className="size-3 text-faint"
    />
  );
}
