import { Toaster as Sonner } from "sonner"

/**
 * Global toast container.
 *
 * Position: "top-right" so notification banners drop in right under the
 * header (search bar + notification bell + user menu are along the top).
 * offset pushes the stack below the sticky header. expand=true lets all
 * active toasts show instead of collapsing.
 *
 * Readability fix (Nathan, 2026-06-12): the old config pointed sonner at
 * `var(--popover)`, but the Tailwind v4 theme only defines
 * `--color-popover` — the variable resolved to nothing and every toast
 * rendered with NO background. Toasts now use the real theme variables
 * plus a solid surface, border, and shadow.
 */
const Toaster = () => {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      offset="64px"
      expand={true}
      toastOptions={{
        classNames: {
          toast:
            "group toast !bg-popover !text-popover-foreground !border-border !shadow-xl !rounded-lg",
          title: "!font-semibold",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
        } as React.CSSProperties
      }
    />
  )
}

export { Toaster }
