// WCAG 2.x sRGB contrast. Keep runtime color math here, not in controls.
// Leave headroom above AA for 8-bit alpha composition in different renderers.
const TEXT_CONTRAST_TARGET = 4.6;
export const BLACK = "#000000";
export const WHITE = "#ffffff";

type RGB = readonly [number, number, number];

export function normalizeHexColor(
  color: string | null | undefined,
): string | null {
  const hex = color?.trim().replace(/^#/, "");
  if (!hex) return null;
  if (/^[a-f\d]{3}$/i.test(hex)) {
    return `#${[...hex].map((digit) => digit.repeat(2)).join("")}`.toLowerCase();
  }
  return /^[a-f\d]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

function channels(color: string): RGB {
  const hex = normalizeHexColor(color);
  if (!hex) throw new Error(`Expected an sRGB hex color: ${color}`);
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableForeground(color: string): string {
  return contrastRatio(color, WHITE) >= contrastRatio(color, BLACK)
    ? WHITE
    : BLACK;
}

function mix(color: string, target: string, amount: number): string {
  const from = channels(color);
  return `#${channels(target)
    .map((channel, index) =>
      Math.round(from[index] + (channel - from[index]) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Preserve the chosen hue as far as an sRGB shade allows. Light surfaces use
 * white labels; dark surfaces use black labels. Text also stays readable when
 * primary is used as text on the theme's solid surfaces or a 10% primary tint.
 * The caller supplies the supported surface ladder from the CSS token layer.
 */
export function accessiblePrimary(
  seed: string,
  theme: "light" | "dark",
  surfaces: readonly string[],
): { background: string; foreground: string } {
  const foreground = theme === "light" ? WHITE : BLACK;
  const endpoint = theme === "light" ? BLACK : WHITE;
  const meetsContrast = (color: string) =>
    contrastRatio(color, foreground) >= TEXT_CONTRAST_TARGET &&
    surfaces.every(
      (surface) =>
        contrastRatio(color, mix(surface, color, 0.1)) >= TEXT_CONTRAST_TARGET,
    );
  if (meetsContrast(seed)) return { background: seed, foreground };
  if (!meetsContrast(endpoint)) {
    throw new Error(
      "Primary color requires a consistent light or dark surface ladder",
    );
  }
  let low = 0;
  let high = 1;
  let background = endpoint;
  // Search the smallest adjustment. Check rounded sRGB colors, not ideal floats.
  for (let step = 0; step < 24; step += 1) {
    const amount = (low + high) / 2;
    const candidate = mix(seed, endpoint, amount);
    if (meetsContrast(candidate)) {
      high = amount;
      background = candidate;
    } else {
      low = amount;
    }
  }
  return { background, foreground };
}
