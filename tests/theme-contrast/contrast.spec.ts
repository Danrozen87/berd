import { expect, test, type Locator, type Page } from "@playwright/test";

// Read actual browser colors. Canvas normalizes rgb(), color() and color-mix()
// into rendered sRGB; the assertions do not call the production color resolver.
async function color(
  locator: Locator,
  property: string,
  backdrop?: number[],
): Promise<number[]> {
  return locator.evaluate(
    (element, { property, backdrop }) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas color conversion unavailable");
      if (backdrop) {
        context.fillStyle = `rgb(${backdrop.slice(0, 3).join(" ")})`;
        context.fillRect(0, 0, 1, 1);
      }
      context.fillStyle = getComputedStyle(element).getPropertyValue(property);
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    },
    { property, backdrop },
  );
}

function contrast(first: number[], second: number[]): number {
  const luminance = (value: number[]) =>
    value
      .slice(0, 3)
      .map((c) => {
        const channel = c / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (sum, channel, index) =>
          sum + channel * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function assertControls(page: Page) {
  const surface = await color(page.getByTestId("surface"), "background-color");
  const primary = page.getByRole("button", { name: "Primary action" });
  expect(
    contrast(
      await color(primary, "color"),
      await color(primary, "background-color"),
    ),
  ).toBeGreaterThanOrEqual(4.5);
  for (const state of ["Checked", "Unchecked"]) {
    const control = page.getByRole("switch", {
      name: `${state} switch`,
      exact: true,
    });
    const track = await color(control, "background-color");
    const thumb = await color(
      control.locator('[data-slot="switch-thumb"]'),
      "background-color",
    );
    expect(contrast(track, surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(thumb, track)).toBeGreaterThanOrEqual(3);
  }
  for (const role of ["checkbox", "radio"] as const) {
    const checked = page.getByRole(role, {
      name: `Checked ${role}`,
      exact: true,
    });
    const unchecked = page.getByRole(role, {
      name: `Unchecked ${role}`,
      exact: true,
    });
    expect(
      contrast(await color(checked, "background-color"), surface),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(await color(unchecked, "border-top-color"), surface),
    ).toBeGreaterThanOrEqual(3);
  }
  expect(
    contrast(
      await color(
        page.getByText("Supporting text stays readable on the card."),
        "color",
      ),
      surface,
    ),
  ).toBeGreaterThanOrEqual(4.5);
  const muted = await color(
    page.getByTestId("muted-surface"),
    "background-color",
  );
  for (const sample of ["primary-on-muted", "primary-on-tint"]) {
    const text = page.getByTestId(sample);
    const background =
      sample === "primary-on-muted"
        ? muted
        : await color(text, "background-color", muted);
    const foreground = await color(text, "color");
    expect(
      contrast(foreground, background),
      `${sample}: ${JSON.stringify({ foreground, background })}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

async function assertFocus(control: Locator, surface: Locator) {
  await expect(control).toBeFocused();
  const outline = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(":focus-visible"),
      width: style.outlineWidth,
      offset: style.outlineOffset,
      style: style.outlineStyle,
    };
  });
  expect(outline).toEqual({
    visible: true,
    width: "2px",
    offset: "3px",
    style: "solid",
  });
  expect(
    contrast(
      await color(control, "outline-color"),
      await color(surface, "background-color"),
    ),
  ).toBeGreaterThanOrEqual(3);
}

for (const theme of ["light", "dark"]) {
  test(`${theme} controls preserve contrast across custom accents and interaction states`, async ({
    page,
  }) => {
    await page.goto("/tests/theme-contrast/fixture.html");
    await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
    for (const seed of [
      "#3b7ce4",
      "#ffcc00",
      "#00ffff",
      "#ff00ff",
      "#777777",
      "#ffffff",
      "#000000",
    ]) {
      await page.getByRole("textbox", { name: "Accent seed" }).fill(seed);
      await settle(page);
      await assertControls(page);
      const primary = page.getByRole("button", { name: "Primary action" });
      await primary.hover();
      await settle(page);
      expect(
        contrast(
          await color(primary, "color"),
          await color(primary, "background-color"),
        ),
        seed,
      ).toBeGreaterThanOrEqual(4.5);
      await page.mouse.down();
      await settle(page);
      expect(
        contrast(
          await color(primary, "color"),
          await color(primary, "background-color"),
        ),
        seed,
      ).toBeGreaterThanOrEqual(4.5);
      await page.mouse.up();
      await page.mouse.move(0, 0);
    }
  });
}

test("system mode re-derives shades, retains the seed, and restores defaults", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/tests/theme-contrast/fixture.html");
  await page.getByRole("textbox", { name: "Accent seed" }).fill("#3b7ce4");
  await settle(page);
  await assertControls(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  await settle(page);
  await assertControls(page);
  await expect(page.getByRole("textbox", { name: "Accent seed" })).toHaveValue(
    "#3b7ce4",
  );
  await page.reload();
  await settle(page);
  await assertControls(page);
  await page.getByRole("button", { name: "Reset accent" }).click();
  await settle(page);
  await assertControls(page);
  expect(
    await page.evaluate(() => localStorage.getItem("goose-primary-color")),
  ).toBeNull();
});

test("keyboard focus remains visible across shared controls and links", async ({
  page,
  browserName,
}) => {
  await page.goto("/tests/theme-contrast/fixture.html");
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
    await page.getByRole("textbox", { name: "Accent seed" }).fill("#3b7ce4");
    const surface = page.getByTestId("surface");
    const controls = [
      page.getByRole("button", { name: "Primary action" }),
      page.getByRole("button", { name: "Alternative", exact: true }),
      page.getByRole("switch", { name: "Checked switch", exact: true }),
      page.getByRole("switch", { name: "Unchecked switch", exact: true }),
      page.getByRole("checkbox", { name: "Checked checkbox", exact: true }),
      page.getByRole("checkbox", { name: "Unchecked checkbox", exact: true }),
      page.getByRole("radio", { name: "Checked radio", exact: true }),
      page.getByRole("textbox", { name: "Sample input" }),
      page.getByRole("link", { name: "Focusable link" }),
    ];
    await page.getByRole("button", { name: "Reset accent" }).focus();
    for (const control of controls) {
      await page.keyboard.press("Tab");
      // WebKit follows the platform's full keyboard access preference and can
      // skip buttons. Keep keyboard modality while inspecting their focus paint.
      if (browserName === "webkit") await control.focus();
      await settle(page);
      await assertFocus(control, surface);
    }
  }
});

test("keyboard focus contrasts with inverse popover surfaces", async ({
  page,
}) => {
  await page.goto("/tests/theme-contrast/fixture.html");
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
    await page.getByRole("button", { name: "Reset accent" }).click();
    const trigger = page.getByRole("button", { name: "Open inverse popover" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await settle(page);
    await page.getByRole("button", { name: "Inverse popover action" }).focus();
    await assertFocus(
      page.getByRole("button", { name: "Inverse popover action" }),
      page.getByTestId("inverse-surface"),
    );
    await page.keyboard.press("Escape");
  }
});
