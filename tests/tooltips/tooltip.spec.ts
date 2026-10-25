import { expect, test } from "@playwright/test";

async function states(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      JSON.parse(
        document.documentElement.dataset.tooltipStates ?? "[]",
      ) as string[],
  );
}

test("edge hover stays open when a top-bar tooltip flips below its trigger", async ({
  page,
}) => {
  await page.goto("/tests/tooltips/fixture.html");
  const trigger = page.getByRole("button", { name: "Berd home", exact: true });
  const box = await trigger.boundingBox();
  if (!box) throw new Error("Missing top-bar trigger");
  const x = box.x + box.width / 2,
    y = box.y + box.height - 1;
  await page.mouse.move(x, y);
  await page.waitForTimeout(650);
  for (let index = 0; index < 40; index++) {
    await page.mouse.move(x + (index % 2), y);
    await page.waitForTimeout(20);
  }
  await expect(
    page.getByRole("tooltip", { name: "Berd home", exact: true }),
  ).toBeVisible();
  expect((await states(page)).filter(Boolean)).toEqual(["Berd home"]);
  expect(
    await page
      .locator('[data-slot="tooltip-content"]')
      .getAttribute("data-side"),
  ).toBe("bottom");
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("button")
          ?.getAttribute("aria-label"),
      { x, y },
    ),
  ).toBe("Berd home");
  await page.mouse.click(x, y);
  await expect(page.getByLabel("Clicks")).toHaveText("1");
});

test("moving onto tooltip content keeps it readable and Escape dismisses it", async ({
  page,
}) => {
  await page.goto("/tests/tooltips/fixture.html");
  const trigger = page.getByRole("button", {
    name: "Hoverable help",
    exact: true,
  });
  await trigger.hover();
  const tooltip = page.getByRole("tooltip", {
    name: "Readable help",
    exact: true,
  });
  await expect(tooltip).toBeVisible();
  await page.locator('[data-slot="tooltip-content"]').hover();
  await page.waitForTimeout(650);
  await expect(tooltip).toBeVisible();
  expect((await states(page)).filter(Boolean)).toEqual(["Readable help"]);
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
});

test("adjacent enabled and disabled controls do not fight over the open tooltip", async ({
  page,
}) => {
  await page.goto("/tests/tooltips/fixture.html");
  for (const label of ["Berd home", "Sidebar", "Back", "Forward"]) {
    const trigger =
      label === "Forward"
        ? page.locator("[data-button-tooltip-trigger]")
        : page.getByRole("button", { name: label, exact: true });
    await trigger.hover();
    await expect(
      page.getByRole("tooltip", { name: label, exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(200);
    await expect(
      page.locator('[data-slot="tooltip-content"][data-state$="open"]'),
    ).toHaveCount(1);
  }
});

test("activation waits for a new hover and keyboard focus still opens tooltips", async ({
  page,
}) => {
  await page.goto("/tests/tooltips/fixture.html");
  const trigger = page.getByRole("button", { name: "Back", exact: true });
  await trigger.focus();
  await expect(
    page.getByRole("tooltip", { name: "Back", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await trigger.hover();
  await trigger.click();
  await page.waitForTimeout(650);
  await expect(page.getByRole("tooltip")).toBeHidden();
  const box = await trigger.boundingBox();
  if (!box) throw new Error("Missing trigger");
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2);
  await expect(
    page.getByRole("tooltip", { name: "Back", exact: true }),
  ).toBeVisible();
  await trigger.click();
  await page.mouse.move(500, 200);
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2);
  await expect(
    page.getByRole("tooltip", { name: "Back", exact: true }),
  ).toBeVisible();
  // Closed content is retained during its exit animation; wait for the new
  // open state before measuring the subsequent hover, not merely visibility.
  const reopened = page.locator(
    '[data-slot="tooltip-content"][data-state$="open"]',
  );
  await expect(reopened).toBeVisible();
  await expect(reopened).toContainText("Back");
  const opened = (await states(page)).filter(Boolean).length;
  for (let index = 0; index < 20; index++) {
    await page.mouse.move(
      box.x + box.width / 2 + 2 + (index % 2),
      box.y + box.height / 2,
    );
    await page.waitForTimeout(40);
  }
  await expect(
    page.getByRole("tooltip", { name: "Back", exact: true }),
  ).toBeVisible();
  expect((await states(page)).filter(Boolean)).toHaveLength(opened);
});
