#!/usr/bin/env node
// Chrome DevTools Protocol driver for verify-solzero. No extra npm deps.
// Usage is in SKILL.md. Do not point this at a Chrome profile you did not start.

import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const chromeBin = process.env.SOLZERO_VERIFY_CHROME || "google-chrome"
const debugPort = Number(process.env.SOLZERO_VERIFY_CDP_PORT || "9333")
const userDataDir = process.env.SOLZERO_VERIFY_CHROME_PROFILE
const timeoutMs = Number(process.env.SOLZERO_VERIFY_CHROME_TIMEOUT_MS || "45000")

function die(message) {
  console.error(`drive.mjs: ${message}`)
  process.exit(1)
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index < 0 || !process.argv[index + 1]) die(`missing value for ${flag}`)
  return process.argv[index + 1]
}

function hasFlag(flag) {
  return process.argv.includes(flag)
}

async function waitForJson(url, label) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {
      // Chrome is still binding the debug port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  die(`timed out waiting for ${label} at ${url}`)
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.events = new Map()
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id && this.pending.has(message.id)) {
        const { resolve: resolvePending, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolvePending(message.result)
        return
      }
      if (message.method && this.events.has(message.method)) {
        this.events.get(message.method)(message.params)
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method) {
    return new Promise((resolveOnce) => {
      this.events.set(method, (params) => {
        this.events.delete(method)
        resolveOnce(params)
      })
    })
  }
}

async function connectCdp() {
  if (!userDataDir) die("SOLZERO_VERIFY_CHROME_PROFILE is required")
  mkdirSync(userDataDir, { recursive: true })

  const chrome = spawn(
    chromeBin,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  )

  const version = await waitForJson(
    `http://127.0.0.1:${debugPort}/json/version`,
    "Chrome DevTools",
  )
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener("open", resolveOpen)
    ws.addEventListener("error", () => reject(new Error("Chrome DevTools websocket failed")))
  })
  const cdp = new Cdp(ws)
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  return { chrome, cdp, ws }
}

async function navigate(cdp, url) {
  const load = cdp.once("Page.loadEventFired")
  await cdp.send("Page.navigate", { url })
  await Promise.race([
    load,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out navigating to ${url}`)), timeoutMs),
    ),
  ])
  await new Promise((resolveWait) => setTimeout(resolveWait, 400))
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed")
  }
  return result.result?.value
}

function writeOut(path, contents, encoding = "utf8") {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, contents, encoding)
  return abs
}

async function withPage(fn) {
  const session = await connectCdp()
  try {
    return await fn(session.cdp)
  } finally {
    session.ws.close()
    session.chrome.kill("SIGTERM")
  }
}

async function cmdDump() {
  const url = argValue("--url")
  const out = argValue("--out")
  await withPage(async (cdp) => {
    await navigate(cdp, url)
    const html = await evaluate(cdp, "document.documentElement.outerHTML")
    const text = await evaluate(cdp, "document.body ? document.body.innerText : ''")
    const title = await evaluate(cdp, "document.title")
    const abs = writeOut(out, String(html ?? ""))
    writeOut(`${out}.text`, String(text ?? ""))
    writeOut(`${out}.title`, `${title ?? ""}\n`)
    console.log(`dumped ${url} -> ${abs}`)
  })
}

async function cmdScreenshot() {
  const url = argValue("--url")
  const out = argValue("--out")
  await withPage(async (cdp) => {
    await navigate(cdp, url)
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
    const abs = writeOut(out, Buffer.from(shot.data, "base64"), undefined)
    console.log(`screenshot ${url} -> ${abs}`)
  })
}

async function cmdSignIn() {
  const url = argValue("--url")
  const email = argValue("--email")
  const password = process.env.SOLZERO_VERIFY_ADMIN_PASSWORD
  const outDir = argValue("--out-dir")
  if (!password) die("SOLZERO_VERIFY_ADMIN_PASSWORD is empty; refuse to send a blank password")

  await withPage(async (cdp) => {
    await navigate(cdp, url)
    const formReady = await evaluate(
      cdp,
      `Boolean(document.getElementById("admin-email") && document.getElementById("admin-password") && document.querySelector("form button[type='submit']"))`,
    )
    if (!formReady) die("sign-in form was not present (#admin-email / #admin-password / Sign In)")

    await evaluate(
      cdp,
      `(function () {
        const email = document.getElementById("admin-email");
        const password = document.getElementById("admin-password");
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSet.call(email, ${JSON.stringify(email)});
        email.dispatchEvent(new Event("input", { bubbles: true }));
        nativeSet.call(password, ${JSON.stringify(password)});
        password.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("form button[type='submit']").click();
        return true;
      })()`,
    )

    const started = Date.now()
    let signedIn = false
    while (Date.now() - started < timeoutMs) {
      signedIn = Boolean(
        await evaluate(
          cdp,
          `Boolean(document.querySelector("nav a[href='/']") && document.querySelector("textarea.session-composer-textarea"))`,
        ),
      )
      if (signedIn) break
      await new Promise((resolveWait) => setTimeout(resolveWait, 400))
    }

    const html = await evaluate(cdp, "document.documentElement.outerHTML")
    const text = await evaluate(cdp, "document.body ? document.body.innerText : ''")
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
    mkdirSync(outDir, { recursive: true })
    writeOut(resolve(outDir, "after.html"), String(html ?? ""))
    writeOut(resolve(outDir, "after.text"), String(text ?? ""))
    writeOut(resolve(outDir, "after.png"), Buffer.from(shot.data, "base64"), undefined)
    writeOut(resolve(outDir, "result.txt"), signedIn ? "signed-in\n" : "sign-in-not-confirmed\n")
    if (!signedIn) die("clicked Sign In but Agents composer did not appear")
    console.log(`signed-in ${email} -> ${outDir}`)
  })
}

const command = process.argv[2]
if (command === "dump") await cmdDump()
else if (command === "screenshot") await cmdScreenshot()
else if (command === "sign-in") await cmdSignIn()
else {
  console.error("Usage: drive.mjs dump --url URL --out FILE")
  console.error("       drive.mjs screenshot --url URL --out FILE")
  console.error("       drive.mjs sign-in --url URL --email EMAIL --out-dir DIR")
  process.exit(hasFlag("--help") ? 0 : 2)
}
