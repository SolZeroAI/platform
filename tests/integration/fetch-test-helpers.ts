import { afterEach, vi } from "vitest"

afterEach(() => {
  vi.restoreAllMocks()
})

export function mockFetchResponse(response: Response) {
  const fetchSpy = vi.spyOn(globalThis, "fetch")
  fetchSpy.mockResolvedValue(response)
  return fetchSpy
}
