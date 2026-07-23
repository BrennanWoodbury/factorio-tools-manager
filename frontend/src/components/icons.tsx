import type { SVGProps } from 'react';

/**
 * Minimal line icons (original artwork, ~Material/Feather weight): 24px grid,
 * `currentColor` stroke, rounded joins. Size via the `size` prop; color via CSS
 * `color`. Keep new icons in this same flat, low-detail style.
 */
type IconProps = { size?: number } & SVGProps<SVGSVGElement>;

function Svg({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Globe — "generate new world". */
export function IconWorld(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
    </Svg>
  );
}

/** Terminal prompt ">_" — "import map string". */
export function IconTerminal(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
    </Svg>
  );
}

/** Upload tray — "load from save". */
export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 15V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}
