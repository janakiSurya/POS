import { cn } from "../../lib/format";

const MODAL_SIZES = {
  md: "sm:max-w-md",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-5xl",
  full: "sm:max-w-[min(100%,72rem)]",
};

export function Modal({ open, onClose, title, children, className, size = "md" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-strong/30 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className={cn(
          "w-full max-h-[92dvh] overflow-y-auto rounded-t-xl border border-ash bg-canvas p-4 shadow-sm sm:rounded-xl sm:p-6",
          MODAL_SIZES[size] ?? MODAL_SIZES.md,
          className,
        )}
        role="dialog"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="text-fog hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function BlockingModal({ open, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper p-4">
      <div className="w-full max-w-md rounded-xl border border-ash bg-canvas p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}
