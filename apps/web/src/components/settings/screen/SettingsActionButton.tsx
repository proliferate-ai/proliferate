import { Button } from "@proliferate/ui/primitives/Button";

export function SettingsActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
