import { expect, test, type Page } from "@playwright/test";
import { buildInitScript } from "../e2e/fixtures/tauri-mock";

const slotSelector =
  '[data-app-shell-root="true"] > .goose-zoom-scope > div:first-child';
const mainSelector = '[data-app-shell-root="true"] > .goose-zoom-scope > main';
const toggle = (page: Page, collapsed = false) =>
  page.getByRole("button", {
    name: collapsed ? "Expand sidebar" : "Collapse sidebar",
    exact: true,
  });

async function openHome(page: Page) {
  await page.addInitScript({ content: buildInitScript() });
  await page.addInitScript(() => {
    const runtime = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (name: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = runtime.invoke.bind(runtime);
    runtime.invoke = async (name, args) => {
      if (name === "run_doctor" || name === "run_doctor_fresh")
        return { checks: [] };
      if (name === "migration_status")
        return {
          done: true,
          disabledExtensions: [],
          legacyExtensionCleanupDone: true,
        };
      if (name === "list_berd_app_skills") return { skills: [] };
      return invoke(name, args);
    };
  });
  await page.goto("/");
  await expect(page.locator('button[aria-label="Berd home"]')).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Not now", exact: true });
  if (await dismiss.count()) await dismiss.click();
  await expect(toggle(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => openHome(page));

test("overlay slides at fixed width, stays mounted, and yields clicks when hidden", async ({
  page,
}) => {
  const slot = page.locator(slotSelector);
  const panel = slot.locator(":scope > div");
  const original = await panel.boundingBox();
  const main = await page.locator(mainSelector).boundingBox();
  expect(original).not.toBeNull();
  await panel.evaluate((element) => {
    element.setAttribute("data-persisted", "yes");
  });
  await toggle(page).click();
  const samples = await slot.evaluate(async (element) => {
    const frames: {
      width: number;
      x: number;
      panelWidth: number;
      visibility: string;
    }[] = [];
    const start = performance.now();
    while (performance.now() - start < 450) {
      const panel = element.firstElementChild as HTMLElement;
      const rect = panel.getBoundingClientRect();
      frames.push({
        width: element.getBoundingClientRect().width,
        x: rect.x,
        panelWidth: rect.width,
        visibility: getComputedStyle(panel).visibility,
      });
      await new Promise(requestAnimationFrame);
    }
    return frames;
  });
  expect(
    samples.every(
      (sample) => Math.abs(sample.width - (original?.width ?? 0)) < 1,
    ),
  ).toBe(true);
  expect(
    samples.every(
      (sample) => Math.abs(sample.panelWidth - (original?.width ?? 0)) < 1,
    ),
  ).toBe(true);
  expect(
    samples.some(
      (sample) => sample.x < 0 && sample.x > -(original?.width ?? 0),
    ),
  ).toBe(true);
  expect(samples.at(-1)?.visibility).toBe("hidden");
  await expect(panel).toHaveAttribute("inert", "");
  await expect(panel).toHaveAttribute("data-persisted", "yes");
  expect(await page.locator(mainSelector).boundingBox()).toEqual(main);

  await page.locator(mainSelector).evaluate((element) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "sidebar-click-probe";
    button.style.cssText =
      "position:absolute;left:30px;top:180px;width:100px;height:40px";
    button.textContent = "Canvas probe";
    button.onclick = () => {
      button.textContent = "Clicked canvas";
    };
    element.append(button);
  });
  const probe = page.locator("#sidebar-click-probe");
  const rect = await probe.boundingBox();
  if (!rect) throw new Error("Canvas probe must be visible");
  await page.mouse.click(rect.x + 20, rect.y + 20);
  await expect(probe).toHaveText("Clicked canvas");
  await page.keyboard.press("Tab");
  expect(
    await panel.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(false);
  await toggle(page, true).click();
  await expect(panel).not.toHaveAttribute("inert", "");
  await expect(panel).toHaveAttribute("data-persisted", "yes");
  await expect
    .poll(async () => (await panel.boundingBox())?.x)
    .toBe(original?.x);
});

test("reverses mid-slide, preserves resize handles, and retains flow-page layout", async ({
  page,
}) => {
  const slot = page.locator(slotSelector);
  const panel = slot.locator(":scope > div");
  await toggle(page).click();
  await page.waitForTimeout(90);
  await toggle(page, true).click();
  await expect
    .poll(() => slot.evaluate((element) => getComputedStyle(element).clipPath))
    .toBe("none");
  await expect(panel).toBeVisible();
  const rail = panel.locator(".sidebar-resize-rail");
  const before = await panel.boundingBox();
  const handle = await rail.boundingBox();
  if (!handle || !before)
    throw new Error("Expanded sidebar must expose its resize rail");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + 100, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before.width + 30);
  await toggle(page).click();
  await expect(panel).toBeHidden();
  await toggle(page, true).click();
  await expect
    .poll(() => slot.evaluate((element) => getComputedStyle(element).clipPath))
    .toBe("none");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const mainBefore = await page.locator(mainSelector).boundingBox();
  await toggle(page).click();
  await expect.poll(async () => (await slot.boundingBox())?.width).toBe(0);
  const mainAfter = await page.locator(mainSelector).boundingBox();
  expect(mainAfter?.width ?? 0).toBeGreaterThan(mainBefore?.width ?? 0);
});

test("reacts to reduced motion without a slide, fade, or clipping delay", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const slot = page.locator(slotSelector);
  const panel = slot.locator(":scope > div");
  await toggle(page).click();
  await expect(panel).toBeHidden();
  expect(
    await panel.evaluate(
      (element) => getComputedStyle(element).transitionProperty,
    ),
  ).toBe("none");
  await toggle(page, true).click();
  await expect(panel).toBeVisible();
  expect(
    await slot.evaluate((element) => getComputedStyle(element).clipPath),
  ).toBe("none");
  expect(
    await panel
      .locator(".sidebar-resize-rail")
      .evaluate((element) => getComputedStyle(element).transitionProperty),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() =>
      panel.evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toContain("0.32s");
});
