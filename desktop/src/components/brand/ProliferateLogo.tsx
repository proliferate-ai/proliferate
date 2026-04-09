import { ProliferateIcon } from "@/components/ui/icons";

export function ProliferateLogo() {
  return (
    <div className="flex items-center gap-3">
      <ProliferateIcon className="size-10 shrink-0 text-foreground" />
      <span className="font-['Manrope_Variable',Manrope,sans-serif] text-[32px] font-medium tracking-wide text-foreground">
        PROLIFERATE
      </span>
    </div>
  );
}
