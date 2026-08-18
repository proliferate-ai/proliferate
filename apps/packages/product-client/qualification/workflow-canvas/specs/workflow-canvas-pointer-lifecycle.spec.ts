import { expect, test, type Locator, type Page } from "@playwright/test";

test("releasing a connection outside the canvas clears its source", async ({ page }) => {
  await page.goto("/");

  const source = page.getByRole("button", { name: "Connect from A" });
  const target = page.getByRole("button", { name: "Connect into C" });
  const createdEdge = page.getByRole("button", { name: "Remove connection from a to c" });

  await moveToCenter(page, source);
  await page.mouse.down();
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(20, 20);
  await page.mouse.up();

  await expect(source).toHaveAttribute("aria-pressed", "false");
  await moveToCenter(page, target);
  await page.mouse.click(...await center(target));
  await expect(createdEdge).toHaveCount(0);
});

test("releasing on an in-canvas input still authors one connection", async ({ page }) => {
  await page.goto("/");

  const source = page.getByRole("button", { name: "Connect from A" });
  const target = page.getByRole("button", { name: "Connect into C" });
  const createdEdge = page.getByRole("button", { name: "Remove connection from a to c" });

  await moveToCenter(page, source);
  await page.mouse.down();
  await moveToCenter(page, target);
  await page.mouse.up();

  await expect(source).toHaveAttribute("aria-pressed", "false");
  await expect(createdEdge).toHaveCount(1);
});

async function moveToCenter(page: Page, locator: Locator) {
  await page.mouse.move(...await center(locator));
}

async function center(locator: Locator): Promise<[number, number]> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return [box!.x + box!.width / 2, box!.y + box!.height / 2];
}
