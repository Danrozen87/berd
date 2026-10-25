import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme} modal covers navigation and composer, with clear targets and a focus trap`, async ({
    page,
    browserName,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/tests/provider-setup/fixture.html");
    // Open with the keyboard to establish a real prior focus on Safari too;
    // its pointer clicks intentionally leave buttons unfocused.
    await page.getByRole("button", { name: "Show setup" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Connect an AI provider" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const overlay = page.locator('[data-slot="dialog-overlay"]');
    expect(
      await overlay.evaluate(
        (element) => getComputedStyle(element).backdropFilter,
      ),
    ).toContain("blur(");
    for (const name of ["Nav", "Composer"]) {
      const background = await page
        .getByText(name, { exact: true })
        .boundingBox();
      if (!background) throw new Error(`Missing ${name} background target`);
      const point = {
        x: background.x + background.width / 2,
        y: background.y + background.height / 2,
      };
      expect(
        await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.getAttribute("data-slot"),
          point,
        ),
      ).toBe("dialog-overlay");
    }
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    const box = await close.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(32);
    expect(box?.height).toBeGreaterThanOrEqual(32);
    const primary = dialog.getByRole("button", { name: "Open AI providers" });
    const before = await primary.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await primary.hover();
    await expect
      .poll(() =>
        primary.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .not.toBe(before);
    if (browserName === "chromium") {
      for (let index = 0; index < 5; index++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Show setup" }),
    ).toBeFocused();
    await expect(page.getByLabel("Background clicks")).toHaveText("0");
  });
}

test("settings action closes cleanly; background readiness also fades the modal out", async ({
  page,
}) => {
  await page.goto("/tests/provider-setup/fixture.html");
  await page.getByRole("button", { name: "Show setup" }).click();
  await page.getByRole("button", { name: "Open AI providers" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "AI providers settings" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Show setup" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fixture:provider-ready")),
  );
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("small screens and reduced motion retain reachable actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/tests/provider-setup/fixture.html");
  await page.getByRole("button", { name: "Show setup" }).click();
  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(16);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(374);
  expect(
    await dialog.evaluate((element) =>
      parseFloat(getComputedStyle(element).animationDuration),
    ),
  ).toBeLessThanOrEqual(0.00001);
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Composer" }).click();
  await expect(page.getByLabel("Background clicks")).toHaveText("1");
});
