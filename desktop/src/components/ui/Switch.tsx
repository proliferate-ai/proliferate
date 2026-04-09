interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  id?: string;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  id,
  disabled = false,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      id={id}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      className="peer inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
    >
      <span
        data-state={checked ? "checked" : "unchecked"}
        className="pointer-events-none block h-4 w-4 rounded-full bg-background ring-0 shadow-lg transition-transform duration-150 data-[state=checked]:translate-x-[21px] data-[state=unchecked]:translate-x-[1px]"
      />
    </button>
  );
}
