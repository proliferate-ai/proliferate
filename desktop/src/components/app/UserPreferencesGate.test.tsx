import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { UserPreferencesGateView } from "@/components/app/UserPreferencesGate"

function renderGate(preferencesHydrated: boolean) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<UserPreferencesGateView preferencesHydrated={preferencesHydrated} />}>
          <Route path="/" element={<main data-testid="product">Product</main>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe("UserPreferencesGate", () => {
  it("blocks product routes until user preferences hydrate", () => {
    const html = renderGate(false)

    expect(html).toContain("Restoring your setup")
    expect(html).not.toContain("data-testid=\"product\"")
  })

  it("renders product routes after user preferences hydrate", () => {
    const html = renderGate(true)

    expect(html).toContain("data-testid=\"product\"")
    expect(html).not.toContain("Restoring your setup")
  })
})
