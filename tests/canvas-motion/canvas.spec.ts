import { expect, test, type Page } from "@playwright/test";
import type { Layout } from "../../src/features/layout/api/layout";
import { buildInitScript } from "../e2e/fixtures/tauri-mock";

type Audit = {
  active: boolean;
  commits: number;
  calls: string[];
  pointerId: number;
  downTarget?: string;
};
declare global {
  interface Window {
    __CANVAS_MOTION_TEST__: Audit;
  }
}
const pageErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) =>
  expect(pageErrors.get(page) ?? []).toEqual([]),
);

const camera = { centerX: 0, centerY: 0, zoomBps: 10_000 };
const items: Layout["items"] = [
  {
    id: "clock",
    kind: "clock",
    targetId: "widget:clock",
    centerX: -180,
    centerY: -70,
    width: 156,
    height: 156,
    zIndex: 1,
    titleOverride: null,
  },
  {
    id: "chat",
    kind: "session",
    targetId: "canvas-chat",
    centerX: 240,
    centerY: 100,
    width: 260,
    height: 88,
    zIndex: 2,
    titleOverride: null,
  },
];
const node = (page: Page, id = "clock") =>
  page.locator(`[data-home-widget-id="${id}"]`);

async function openCanvas(page: Page, zoom = 1, zoomBps = 10_000) {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript({
    content:
      "globalThis.__name = (fn) => fn;" +
      buildInitScript({
        projects: [],
        sessions: [
          {
            sessionId: "canvas-chat",
            title: "Synthetic canvas chat",
            messageCount: 2,
          },
        ],
        homeLayout: { camera: { ...camera, zoomBps }, items },
      }),
  });
  await page.addInitScript(
    ({ zoom }) => {
      localStorage.setItem("goose-zoom-level", String(zoom));
      // Keep this explicit scene fixed instead of migrating starter widgets.
      localStorage.setItem(
        "goose:home:onboarding-stickies-seeded",
        String(Number.MAX_SAFE_INTEGER),
      );
      const audit: Audit = {
        active: false,
        commits: 0,
        calls: [],
        pointerId: 1,
      };
      window.__CANVAS_MOTION_TEST__ = audit;
      Object.assign(window, {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          supportsFiber: true,
          renderers: new Map(),
          inject: () => 1,
          checkDCE: () => {},
          onCommitFiberRoot: () => {
            if (audit.active) audit.commits++;
          },
          onCommitFiberUnmount: () => {},
        },
      });
      const runtime = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (name: string, args?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const invoke = runtime.invoke.bind(runtime);
      runtime.invoke = async (name, args) => {
        if (audit.active) audit.calls.push(name);
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
      document.addEventListener(
        "pointerdown",
        (event) => {
          audit.pointerId = event.pointerId;
          audit.downTarget =
            (event.target as HTMLElement)
              .closest("[data-home-widget-id]")
              ?.getAttribute("data-home-widget-id") ??
            (event.target as HTMLElement).tagName;
        },
        true,
      );
    },
    { zoom },
  );
  await page.goto("/");
  await expect(page.locator('button[aria-label="Berd home"]')).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Not now", exact: true });
  if (await dismiss.count()) await dismiss.click();
  await expect(node(page)).toBeVisible();
  await expect(page.locator("[data-app-content-preparing]")).toHaveCount(0);
  await expect
    .poll(() => node(page).evaluate((element) => !element.closest("[inert]")))
    .toBe(true);
  await expect(page.locator("[data-home-widget-id]")).toHaveCount(items.length);
}

async function startDrag(page: Page, id = "clock") {
  const widget = node(page, id);
  await expect
    .poll(() =>
      widget.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    )
    .toBe(true);
  const bounds = await widget.boundingBox();
  if (!bounds) throw new Error("Expected a visible widget");
  const start = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 8);
  return { widget, start, bounds };
}

for (const id of ["clock", "chat"]) {
  test(`${id} moves without rerendering its content or changing layout on every input`, async ({
    page,
  }) => {
    await openCanvas(page);
    const { widget, start, bounds } = await startDrag(page, id);
    const layout = await widget.evaluate((element) => ({
      left: element.style.left,
      top: element.style.top,
    }));
    await widget.evaluate((element) => {
      element.firstElementChild?.setAttribute("data-persisted", "yes");
    });
    await page.evaluate(() =>
      Object.assign(window.__CANVAS_MOTION_TEST__, {
        active: true,
        commits: 0,
        calls: [],
      }),
    );
    await widget.evaluate(async (element, start) => {
      for (let index = 1; index <= 100; index++) {
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            composed: true,
            pointerId: window.__CANVAS_MOTION_TEST__.pointerId,
            pointerType: "mouse",
            buttons: 1,
            clientX: start.x + index,
            clientY: start.y + index / 2,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
      await new Promise(requestAnimationFrame);
    }, start);
    const audit = await page.evaluate(() => ({
      ...window.__CANVAS_MOTION_TEST__,
    }));
    expect(audit.downTarget).toBe(id);
    expect(audit.commits).toBeLessThan(8);
    expect(audit.calls).not.toContain("save_layout_items");
    expect(
      await widget.evaluate((element) => ({
        left: element.style.left,
        top: element.style.top,
      })),
    ).toEqual(layout);
    const moved = await widget.boundingBox();
    expect(moved?.x ?? 0).toBeCloseTo(bounds.x + 100, 0);
    expect(moved?.y ?? 0).toBeCloseTo(bounds.y + 50, 0);
    await expect(widget.locator(":scope > div")).toHaveAttribute(
      "data-persisted",
      "yes",
    );
    await page.mouse.move(start.x + 100, start.y + 50);
    await page.mouse.up();
    await expect
      .poll(() => widget.evaluate((element) => element.style.translate))
      .toBe("");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__CANVAS_MOTION_TEST__.calls.filter(
              (call) => call === "save_layout_items",
            ).length,
        ),
      )
      .toBe(1);
    await expect(widget.locator(":scope > div")).toHaveAttribute(
      "data-persisted",
      "yes",
    );
    const settled = await widget.boundingBox();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Berd home", exact: true }).click();
    await expect
      .poll(async () => (await widget.boundingBox())?.x)
      .toBe(settled?.x);
  });
}

for (const zoom of [0.7, 1.3]) {
  test(`follows the pointer at app zoom ${zoom} with camera zoom 1.5`, async ({
    page,
  }) => {
    await openCanvas(page, zoom, 15_000);
    const { widget, start, bounds } = await startDrag(page);
    await page.mouse.move(start.x + 78, start.y + 52);
    await expect
      .poll(async () =>
        Math.abs(((await widget.boundingBox())?.x ?? 0) - bounds.x - 78),
      )
      .toBeLessThan(1);
    await expect
      .poll(async () =>
        Math.abs(((await widget.boundingBox())?.y ?? 0) - bounds.y - 52),
      )
      .toBeLessThan(1);
    await page.mouse.up();
    await expect
      .poll(() => widget.evaluate((element) => element.style.translate))
      .toBe("");
    // The existing24px world-grid snap remains a drop-only operation.
    const end = await widget.boundingBox();
    expect(Math.abs((end?.x ?? 0) - bounds.x - 78)).toBeLessThan(
      24 * 1.5 * zoom,
    );
    expect(Math.abs((end?.y ?? 0) - bounds.y - 52)).toBeLessThan(
      24 * 1.5 * zoom,
    );
    expect(await widget.evaluate((element) => element.style.willChange)).toBe(
      "",
    );
  });
}

test("cancellation clears transient translation without saving", async ({
  page,
}) => {
  await openCanvas(page);
  const { widget, bounds } = await startDrag(page);
  await page.evaluate(() =>
    Object.assign(window.__CANVAS_MOTION_TEST__, { active: true, calls: [] }),
  );
  await widget.evaluate((element) =>
    element.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        composed: true,
        pointerId: window.__CANVAS_MOTION_TEST__.pointerId,
        pointerType: "mouse",
      }),
    ),
  );
  await expect
    .poll(() => widget.evaluate((element) => element.style.translate))
    .toBe("");
  expect((await widget.boundingBox())?.x).toBe(bounds.x);
  expect(
    await page.evaluate(() => window.__CANVAS_MOTION_TEST__.calls),
  ).not.toContain("save_layout_items");
  expect(await widget.evaluate((element) => element.style.willChange)).toBe("");
});
