import type { CSSProperties, ReactNode } from 'react';

/**
 * Inline "this path isn't guaranteed" note. Used on the modded map-gen surfaces,
 * where the sliders and previews depend on a mod set we can't validate ahead of time.
 */
export function ExperimentalNote({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="experimental-note" style={style}>
      <span className="experimental-tag">Experimental</span>
      <span>{children ?? "Not guaranteed to work with every mod set."}</span>
    </div>
  );
}
