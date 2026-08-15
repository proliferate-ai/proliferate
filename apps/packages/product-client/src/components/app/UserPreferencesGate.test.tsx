// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { motion } from "@proliferate/design/motion"
import { UserPreferencesGateView } from "#product/components/app/UserPreferencesGate"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function renderGate(preferencesHydrated: boolean) {
  return render(
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
  it("blocks product routes until user preferences hydrate, and shows the Class A living mark past the show delay", () => {
    renderGate(false)

    expect(screen.queryByTestId("product")).toBeNull()
    // Inside the show-delay window the gate withholds the treatment entirely.
    expect(document.querySelector("[data-brand-mark]")).toBeNull()

    advance(motion.loading.showDelayMs)

    expect(document.querySelector("[data-brand-mark]")).not.toBeNull()
    expect(screen.queryByTestId("product")).toBeNull()
  })

  it("renders product routes after user preferences hydrate", () => {
    renderGate(true)

    expect(screen.getByTestId("product")).not.toBeNull()
    expect(document.querySelector("[data-brand-mark]")).toBeNull()
  })
})
