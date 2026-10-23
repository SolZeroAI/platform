import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { testDeploymentConfig } from "../scripts/e2e/environment"

test("the selected deployment brand reaches the browser", async ({ app, browser, screen }) => {
  const { brand } = testDeploymentConfig
  await app.open("/")
  await expect(screen.getByRole("heading", `Welcome to ${brand.name}`)).toBeVisible()
  await expect(browser).toHaveTitle(`${brand.name} Agent`)
  await expect(browser.locator('link[rel="icon"]')).toHaveAttribute("href", brand.faviconPath)
  await expect(browser.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    brand.appleTouchIconPath,
  )
  const logoPaths = await browser.locator("img").all()
  const sources = await Promise.all(logoPaths.map((logo) => logo.getAttribute("src")))
  expect(sources).toContain(brand.logoLightPath)
})

test("health identifies the configured application without exposing configuration", async () => {
  const response = await fetch("http://localhost:3000/api/health")
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toMatchObject({
    status: "healthy",
    service: `${testDeploymentConfig.deployment.appName}-agent-control-plane`,
    configDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect(Object.keys(body).sort()).toEqual(["configDigest", "service", "status", "version"])
})

test("OpenAPI uses the selected deployment brand", async () => {
  const response = await fetch("http://localhost:3000/api/openapi.json")
  expect(response.status).toBe(200)
  const document = await response.json()
  expect(document.info.title).toBe(`${testDeploymentConfig.brand.name} Agent API`)
  expect(document.info.description).toBe(`API for ${testDeploymentConfig.brand.name} Agent`)
  expect(document.servers).toEqual([{ url: "http://localhost:3000/api" }])
})
