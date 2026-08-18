import { expect, test, type Locator, type Page } from "@playwright/test";

test("midpoint controls stay above legal display-order cards in the production canvas", async ({ page }) => {
  await page.goto("/");

  const crossing = page.getByRole("button", { name: "Remove connection from a to b" });
  const adjacent = page.getByRole("button", { name: "Remove connection from -input- to a" });
  await expect(crossing).toHaveCount(1);
  await expect(adjacent).toHaveCount(1);

  // [a, c, b] puts the a -> b arithmetic midpoint inside C's actual card
  // bounds. Browser hit-testing must still resolve the production edge button.
  await expectHitTarget(page, crossing, "Remove connection from a to b");
  await crossing.focus();
  await expect.poll(() => crossing.evaluate((element) => ({
    focusVisible: element.matches(":focus-visible"),
    opacity: getComputedStyle(element).opacity,
  }))).toEqual({ focusVisible: true, opacity: "1" });

  // Adjacent-edge negative control: the ordinary Input -> A midpoint is also
  // independently hit-testable and is not the control the crossing click hits.
  await expectHitTarget(page, adjacent, "Remove connection from -input- to a");

  const box = await crossing.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  await expect(crossing).toHaveCount(0);
  await expect(adjacent).toHaveCount(1);
});

async function expectHitTarget(page: Page, locator: Locator, expectedLabel: string) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const label = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ?? null
  ), {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  });
  expect(label).toBe(expectedLabel);
}
