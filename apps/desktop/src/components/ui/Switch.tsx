import type { ButtonHTMLAttributes } from "react";

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (value: boolean) => void;
  size?: "default" | "compact";
}

export function Switch({
  checked,
  onChange,
  id,
  disabled = false,
  size = "default",
  className = "",
  ...props
}: SwitchProps) {
  const trackClass = size === "compact" ? "h-5 w-8" : "h-5 w-10";
  const thumbClass = size === "compact"
    ? "h-4 w-4 data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-[1px]"
    : "h-4 w-4 data-[state=checked]:translate-x-[21px] data-[state=unchecked]:translate-x-[1px]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      id={id}
      disabled={disabled}
      className={`peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input ${trackClass} ${className}`}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      {...props}
    >
      <span
        data-state={checked ? "checked" : "unchecked"}
        className={`pointer-events-none block rounded-full bg-background ring-0 shadow-lg transition-transform duration-150 ${thumbClass}`}
      />
    </button>
  );
}
