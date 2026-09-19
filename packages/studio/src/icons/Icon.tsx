import type { CSSProperties, SVGProps } from "react";
import { GLYPHS, type Glyph, type IconName, type Shape } from "./glyphs";

export type { IconName };

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "fill" | "stroke"> {
  name: IconName;
  /** Rendered size in px; the stroke picks its weight from the size class. */
  size?: number | string;
  /** Standalone icon with no visible label: announced instead of hidden. */
  title?: string;
  /** Active state: the glyph is painted solid. */
  filled?: boolean;
  style?: CSSProperties;
}

// Size classes, not a linear scale: 12/14 px get the thinner stroke.
export function strokeWidthFor(size: number | string): number {
  const px = typeof size === "number" ? size : Number.parseFloat(size);
  return Number.isFinite(px) && px < 14 ? 1.25 : 1.5;
}

const num = (s: string) => s.split(" ").slice(1).map(Number);

function renderShape(shape: Shape, i: number) {
  if (shape.startsWith("r ")) {
    const [x, y, w, h, rx] = num(shape);
    return <rect key={i} x={x} y={y} width={w} height={h} rx={rx} />;
  }
  if (shape.startsWith("c ")) {
    const [cx, cy, r] = num(shape);
    return <circle key={i} cx={cx} cy={cy} r={r} />;
  }
  if (shape.startsWith("d ")) {
    const [cx, cy, r] = num(shape);
    return <circle key={i} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
  }
  return <path key={i} d={shape} />;
}

export function Icon({ name, size = 16, title, filled, ...rest }: IconProps) {
  const glyph: Glyph = GLYPHS[name];
  const solid = glyph.solid || (filled && glyph.fillable);
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={solid ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidthFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
      data-icon={name}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {glyph.shapes.map(renderShape)}
    </svg>
  );
}
