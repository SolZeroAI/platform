#!/usr/bin/env node
// Chrome DevTools Protocol driver for verify-solzero. No extra npm deps.
// Usage is in SKILL.md. Do not point this at a Chrome profile you did not start.

import { spawn } from "node:child_process"
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const chromeBin = process.env.SOLZERO_VERIFY_CHROME || "google-chrome"
const debugPort = Number(process.env.SOLZERO_VERIFY_CDP_PORT || "9334")
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
    this.sessionId = undefined
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

  send(method, params = {}, sessioned = true) {
    const id = this.nextId++
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject })
      const payload = { id, method, params }
      if (sessioned && this.sessionId) payload.sessionId = this.sessionId
      this.ws.send(JSON.stringify(payload))
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
  const profile = `${userDataDir}-${process.pid}`
  mkdirSync(profile, { recursive: true })
  const logPath = process.env.SOLZERO_VERIFY_CHROME_LOG || `${profile}.log`
  const log = createWriteStream(logPath, { flags: "a" })

  const chrome = spawn(
    chromeBin,
    [
      `--remote-debugging-port=${debugPort}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  chrome.stdout.pipe(log)
  chrome.stderr.pipe(log)
  const pidFile = process.env.SOLZERO_VERIFY_CHROME_PID_FILE
  if (pidFile) writeFileSync(pidFile, `${chrome.pid}\n`)
  chrome.once("exit", (code, signal) => {
    console.error(`drive.mjs: chrome exited code=${code} signal=${signal}; see ${logPath}`)
  })

  let ws
  try {
    const started = Date.now()
    let version
    while (Date.now() - started < timeoutMs) {
      if (chrome.exitCode !== null) {
        die(`chrome exited before DevTools listen (code=${chrome.exitCode}); see ${logPath}`)
      }
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        if (response.ok) {
          version = await response.json()
          break
        }
      } catch {
        // Chrome is still binding the debug port.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200))
    }
    if (!version?.webSocketDebuggerUrl) {
      die(`timed out waiting for Chrome DevTools at http://127.0.0.1:${debugPort}/json/version; see ${logPath}`)
    }
    ws = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolveOpen, reject) => {
      ws.addEventListener("open", resolveOpen)
      ws.addEventListener("error", () => reject(new Error("Chrome DevTools websocket failed")))
    })
    const cdp = new Cdp(ws)
    const created = await cdp.send("Target.createTarget", { url: "about:blank" }, false)
    const attached = await cdp.send(
      "Target.attachToTarget",
      { targetId: created.targetId, flatten: true },
      false,
    )
    cdp.sessionId = attached.sessionId
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    return { chrome, cdp, ws }
  } catch (error) {
    ws?.close()
    chrome.kill("SIGTERM")
    throw error
  }
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

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

async function waitFor(cdp, expression, label) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(cdp, expression)
    if (value) return value
    await sleep(200)
  }
  die(`timed out waiting for ${label}`)
}

async function dumpPage(cdp, outDir) {
  const html = await evaluate(cdp, "document.documentElement.outerHTML")
  const text = await evaluate(cdp, "document.body ? document.body.innerText : ''")
  const title = await evaluate(cdp, "document.title")
  const href = await evaluate(cdp, "location.href")
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
  mkdirSync(outDir, { recursive: true })
  writeOut(resolve(outDir, "after.html"), String(html ?? ""))
  writeOut(resolve(outDir, "after.text"), String(text ?? ""))
  writeOut(resolve(outDir, "after.title"), `${title ?? ""}\n`)
  writeOut(resolve(outDir, "after.href"), `${href ?? ""}\n`)
  writeOut(resolve(outDir, "after.png"), Buffer.from(shot.data, "base64"), undefined)
}

async function signInOnPage(cdp, email, password) {
  await waitFor(
    cdp,
    `Boolean(document.getElementById("admin-email") && document.getElementById("admin-password") && document.querySelector("form"))`,
    "sign-in form (#admin-email / #admin-password)",
  )
  // Client hydration attaches React onSubmit. A click before that does a native GET
  // and leaves the welcome form on screen with no toast.
  await waitFor(
    cdp,
    `Boolean(document.querySelector("script[src*='tanstack-start-dev-client']") && document.getElementById("admin-email"))`,
    "TanStack Start client script",
  )
  await sleep(1500)

  await evaluate(
    cdp,
    `(function () {
      const email = document.getElementById("admin-email");
      const password = document.getElementById("admin-password");
      const form = document.querySelector("form");
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSet.call(email, ${JSON.stringify(email)});
      email.dispatchEvent(new Event("input", { bubbles: true }));
      email.dispatchEvent(new Event("change", { bubbles: true }));
      nativeSet.call(password, ${JSON.stringify(password)});
      password.dispatchEvent(new Event("input", { bubbles: true }));
      password.dispatchEvent(new Event("change", { bubbles: true }));
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
      return true;
    })()`,
  )

  await waitFor(
    cdp,
    `Boolean(document.querySelector("nav a[href='/']") && document.querySelector("textarea.session-composer-textarea"))`,
    "Agents composer after Sign In",
  )
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
    try {
      await signInOnPage(cdp, email, password)
      await dumpPage(cdp, outDir)
      writeOut(resolve(outDir, "result.txt"), "signed-in\n")
      console.log(`signed-in ${email} -> ${outDir}`)
    } catch (error) {
      await dumpPage(cdp, outDir)
      writeOut(resolve(outDir, "result.txt"), "sign-in-not-confirmed\n")
      throw error
    }
  })
}

async function cmdSignedInOpen() {
  const url = argValue("--url")
  const email = argValue("--email")
  const password = process.env.SOLZERO_VERIFY_ADMIN_PASSWORD
  const outDir = argValue("--out-dir")
  if (!password) die("SOLZERO_VERIFY_ADMIN_PASSWORD is empty; refuse to send a blank password")

  await withPage(async (cdp) => {
    await navigate(cdp, "http://localhost:3000/")
    await signInOnPage(cdp, email, password)
    if (!/^https?:\/\/localhost:3000\/?$/.test(url)) {
      await navigate(cdp, url)
      await sleep(800)
    }
    await dumpPage(cdp, outDir)
    const text = await evaluate(cdp, "document.body ? document.body.innerText : ''")
    const stillWelcome = Boolean(
      await evaluate(cdp, `Boolean(document.getElementById("admin-email"))`),
    )
    writeOut(resolve(outDir, "result.txt"), stillWelcome ? "signed-out\n" : "signed-in\n")
    if (stillWelcome) die(`opened ${url} but the welcome form was still present`)
    console.log(`signed-in-open ${url} -> ${outDir}`)
    if (typeof text === "string") {
      // Keep a one-line proof cue on stdout. Do not print secrets.
      const cue = text.split("\n").map((line) => line.trim()).filter(Boolean)[0] || ""
      if (cue) console.log(`visible ${cue}`)
    }
  })
}

async function cmdCreateBot() {
  const email = argValue("--email")
  const name = argValue("--name")
  const password = process.env.SOLZERO_VERIFY_ADMIN_PASSWORD
  const outDir = argValue("--out-dir")
  if (!password) die("SOLZERO_VERIFY_ADMIN_PASSWORD is empty; refuse to send a blank password")
  if (!name.trim()) die("create-bot needs a non-empty --name")

  await withPage(async (cdp) => {
    await navigate(cdp, "http://localhost:3000/")
    await signInOnPage(cdp, email, password)
    await navigate(cdp, "http://localhost:3000/bots")
    await waitFor(
      cdp,
      `Boolean(document.querySelector("input[aria-label='Bot name']") && document.body.innerText.includes("Always-on bots"))`,
      "Bots index",
    )
    await evaluate(
      cdp,
      `(function () {
        const nameInput = document.querySelector("input[aria-label='Bot name']");
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSet.call(nameInput, ${JSON.stringify(name)});
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
        const button = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Create bot");
        if (!button) throw new Error("Create bot button missing");
        button.click();
        return true;
      })()`,
    )
    await waitFor(
      cdp,
      `Boolean(location.pathname.startsWith("/bots/") && location.pathname !== "/bots")`,
      "bot detail after create",
    )
    await dumpPage(cdp, outDir)
    writeOut(resolve(outDir, "result.txt"), `created ${name}\n`)
    console.log(`created-bot ${name} -> ${outDir}`)
  })
}

const command = process.argv[2]
if (command === "dump") await cmdDump()
else if (command === "screenshot") await cmdScreenshot()
else if (command === "sign-in") await cmdSignIn()
else if (command === "signed-in-open") await cmdSignedInOpen()
else if (command === "create-bot") await cmdCreateBot()
else {
  console.error("Usage: drive.mjs dump --url URL --out FILE")
  console.error("       drive.mjs screenshot --url URL --out FILE")
  console.error("       drive.mjs sign-in --url URL --email EMAIL --out-dir DIR")
  console.error("       drive.mjs signed-in-open --url URL --email EMAIL --out-dir DIR")
  console.error("       drive.mjs create-bot --name NAME --email EMAIL --out-dir DIR")
  process.exit(hasFlag("--help") ? 0 : 2)
}
