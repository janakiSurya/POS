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
      "bg-white text-charcoal hover:bg-white/90 disabled:opacity-50 font-semibold",
    secondary:
      "border border-white text-white bg-transparent hover:bg-charcoal-3 disabled:opacity-50",
    danger:
      "border border-danger text-danger bg-transparent hover:bg-danger/10 disabled:opacity-50",
    ghost: "text-white-muted hover:text-white hover:bg-charcoal-3",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "rounded-lg px-4 py-2.5 text-sm transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
