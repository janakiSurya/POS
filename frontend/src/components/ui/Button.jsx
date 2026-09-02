import { cn } from "../../lib/format";

export function Button({
  children,
  variant = "primary",
  className,
  disabled,
  ...props
}) {
  const variants = {
    primary:
      "bg-action text-canvas hover:bg-ink-strong disabled:opacity-50 font-medium shadow-subtle",
    secondary:
      "border border-ash text-ink bg-canvas hover:bg-paper disabled:opacity-50 font-medium",
    danger:
      "border border-danger/40 text-danger bg-canvas hover:bg-danger/5 disabled:opacity-50 font-medium",
    ghost: "text-fog hover:text-ink hover:bg-paper font-medium",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "rounded-lg px-4 py-2 text-sm transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
