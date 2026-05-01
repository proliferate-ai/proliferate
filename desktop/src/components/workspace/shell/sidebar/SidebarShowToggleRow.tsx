import { Button } from "@/components/ui/Button";

export function SidebarShowToggleRow({
  label,
  onClick,
}: {
  label: "Show more" | "Show less";
  onClick: () => void;
}) {
  return (
    <div className="pl-6 pr-2 pt-0.5 pb-1">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        onClick={onClick}
        className="rounded-full border border-transparent px-2 py-0.5 text-sm leading-[18px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-offset-2"
      >
        {label}
      </Button>
    </div>
  );
}
