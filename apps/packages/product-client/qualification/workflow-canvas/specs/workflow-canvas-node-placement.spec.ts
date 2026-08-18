import { expect, test, type Locator } from "@playwright/test";

/**
 * Moving a card takes a pointer capture, and a capture can retarget the click
 * that closes the gesture. jsdom cannot show that: only a real browser decides
 * where the click lands, so selection-after-press is proven here.
 */
test("dragging a card moves it and still leaves it selectable", async ({ page }) => {
  await page.goto("/");

  const card = page.getByRole("button", { name: /^01 Agent A/ });
  const before = await box(card);

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 30);
  await page.mouse.move(before.x + before.width / 2 + 140, before.y + before.height / 2 + 60);
  await page.mouse.up();

  const after = await box(card);
  expect(Math.round(after.x - before.x)).toBe(140);
  expect(Math.round(after.y - before.y)).toBe(60);
  // The card the gesture ended on is the card the click selects.
  await expect(card).toHaveAttribute("aria-pressed", "true");

  // Its wire followed it: the edge control sits at the midpoint of the drawn path.
  const edge = page.getByRole("button", { name: "Remove connection from a to b" });
  const edgeBox = await box(edge);
  expect(edgeBox.x).toBeGreaterThan(before.x + before.width / 2);
});

test("a press that does not move selects without moving the card", async ({ page }) => {
  await page.goto("/");

  const card = page.getByRole("button", { name: /^03 Agent B/ });
  const before = await box(card);

  await card.click();

  const after = await box(card);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  await expect(card).toHaveAttribute("aria-pressed", "true");
});

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}
