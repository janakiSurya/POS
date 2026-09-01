import { cn } from "../../lib/format";

export function Select({ className, ...props }) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-white focus:border-white focus:outline-none focus:ring-1 focus:ring-white",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-white placeholder:text-white-faint focus:border-white focus:outline-none focus:ring-1 focus:ring-white",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, className }) {
  return (
    <label className={cn("block text-sm font-medium text-white-muted mb-1", className)}>
      {children}
    </label>
  );
}
