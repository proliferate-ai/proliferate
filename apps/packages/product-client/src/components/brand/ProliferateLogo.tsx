import { ProliferateIcon } from "@proliferate/ui/proliferate-icons";

export function ProliferateLogo() {
  return (
    <div className="flex items-center gap-3 text-[length:var(--text-hero)] leading-[var(--text-hero--line-height)]">
      <ProliferateIcon className="icon-large shrink-0 text-foreground" />
      <span className="font-['Manrope_Variable',Manrope,sans-serif] font-medium tracking-wide text-foreground">
        PROLIFERATE
      </span>
    </div>
  );
}
