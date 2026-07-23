import type { CSSProperties, ReactNode } from 'react';

/**
 * A reusable disclosure "drawer": a bordered header with a rotating chevron and a
 * Show/Hide affordance that reads as clearly expandable, plus a subtle hover and
 * open animation. Built on native <details> so keyboard toggling and semantics come
 * for free. `onOpenChange` fires on toggle (use it for lazy-loading a body).
 */
export function Collapsible({
  title,
  hint,
  defaultOpen = false,
  onOpenChange,
  children,
  style,
}: {
  title: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <details
      className="drawer"
      style={style}
      open={defaultOpen}
      onToggle={(e) => onOpenChange?.((e.target as HTMLDetailsElement).open)}
    >
      <summary className="drawer-summary">
        <span className="drawer-chevron" aria-hidden>
          ▸
        </span>
        <span className="drawer-titles">
          <span className="drawer-title">{title}</span>
          {hint != null && <span className="drawer-hint">{hint}</span>}
        </span>
        <span className="drawer-toggle" aria-hidden />
      </summary>
      <div className="drawer-body">{children}</div>
    </details>
  );
}
