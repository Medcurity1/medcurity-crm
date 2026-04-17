import { Toaster as Sonner } from "sonner"

/**
 * Global toast container.
 *
 * Position: "top-right" so notification banners drop in right under the
 * header (search bar + notification bell + user menu are along the top).
 * offset pushes the stack below the sticky header. expand=true lets all
 * active toasts show instead of collapsing.
 */
const Toaster = () => {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      offset="64px"
      expand={true}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
    />
  )
}

export { Toaster }
