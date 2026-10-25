import { describe, expect, it } from "vitest";
import {
  accessiblePrimary,
  contrastRatio,
  normalizeHexColor,
  readableForeground,
} from "./colorContrast";

const SURFACES = {
  light: ["#ffffff", "#f5f5f5", "#f0f0f0"],
  dark: ["#1a1a1a", "#333333", "#4c4c4c"],
} as const;

function tint(
  background: string,
  foreground: string,
  round = Math.round,
): string {
  return `#${[1, 3, 5]
    .map((offset) => {
      const base = Number.parseInt(background.slice(offset, offset + 2), 16);
      const fill = Number.parseInt(foreground.slice(offset, offset + 2), 16);
      return round(base * 0.9 + fill * 0.1)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function colorGrid(): string[] {
  const channels = [0, 51, 102, 153, 204, 255];
  const grid = channels.flatMap((r) =>
    channels.flatMap((g) =>
      channels.map(
        (b) =>
          `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
      ),
    ),
  );
  const grays = Array.from(
    { length: 256 },
    (_, value) => `#${value.toString(16).padStart(2, "0").repeat(3)}`,
  );
  return [
    ...new Set([...grid, ...grays, "#3b7ce4", "#22c55e", "#ffcc00", "#777777"]),
  ];
}

describe("WCAG sRGB contrast", () => {
  it("matches reference ratios without rounding a failure up to a pass", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.478089, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#123456", "#123456")).toBe(1);
  });

  it("normalizes accepted seeds and rejects invalid or transparent values", () => {
    expect(normalizeHexColor(" ABC ")).toBe("#aabbcc");
    expect(normalizeHexColor("#3B7CE4")).toBe("#3b7ce4");
    for (const value of ["", "red", "#abcd", "#12345678", "#zzzzzz", null]) {
      expect(normalizeHexColor(value)).toBeNull();
    }
  });

  it("keeps swatch glyphs readable on exact, unmodified seed colors", () => {
    for (const seed of colorGrid()) {
      expect(
        contrastRatio(seed, readableForeground(seed)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe.each(["light", "dark"] as const)("%s primary roles", (theme) => {
  it("meets text contrast across RGB samples, every gray and 10% tinted surfaces", () => {
    for (const seed of colorGrid()) {
      const pair = accessiblePrimary(seed, theme, SURFACES[theme]);
      expect(
        contrastRatio(pair.background, pair.foreground),
        seed,
      ).toBeGreaterThanOrEqual(4.5);
      for (const surface of SURFACES[theme]) {
        expect(
          contrastRatio(pair.background, surface),
          seed,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(pair.background, tint(surface, pair.background)),
          seed,
        ).toBeGreaterThanOrEqual(4.5);
        // Bound the 8-bit compositing difference observed across renderers.
        const conservative = tint(
          surface,
          pair.background,
          theme === "light" ? Math.floor : Math.ceil,
        );
        expect(
          contrastRatio(pair.background, conservative),
          seed,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

it("retains an already suitable primary shade", () => {
  expect(accessiblePrimary("#004b9b", "light", SURFACES.light).background).toBe(
    "#004b9b",
  );
  expect(accessiblePrimary("#badaff", "dark", SURFACES.dark).background).toBe(
    "#badaff",
  );
});
