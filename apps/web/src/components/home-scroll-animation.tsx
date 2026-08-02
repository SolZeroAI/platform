"use client"

import { useGSAP } from "@gsap/react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { ScrollToPlugin } from "gsap/ScrollToPlugin"
import { useCallback, useRef, type RefObject } from "react"

let gsapRegistered = false
const SNAP_THRESHOLD_RATIO = 0.36
const SNAP_SETTLE_DELAY_MS = 140

interface HomeScrollAnimationRefs {
  enabled: boolean
  containerRef: RefObject<HTMLDivElement | null>
  heroRef: RefObject<HTMLElement | null>
  tableRef: RefObject<HTMLDivElement | null>
  floatingHeaderRef: RefObject<HTMLButtonElement | null>
  scrollCueRef: RefObject<HTMLButtonElement | null>
  inputRef: RefObject<HTMLTextAreaElement | null>
}

type SnapView = "hero" | "table"

interface HomeScrollSnapController {
  snapTo: (view: SnapView, options?: { focusInput?: boolean }) => void
  snapToTableReliably: () => void
  destroy: () => void
}

export function useHomeScrollAnimation({
  enabled,
  containerRef,
  heroRef,
  tableRef,
  floatingHeaderRef,
  scrollCueRef,
  inputRef,
}: HomeScrollAnimationRefs) {
  const snapControllerRef = useRef<HomeScrollSnapController | null>(null)
  const pendingSnapRef = useRef<SnapView | null>(null)
  const { contextSafe } = useGSAP(
    () => {
      if (!enabled || typeof window === "undefined") {
        return
      }
      registerGsap()

      const scroller = containerRef.current
      const hero = heroRef.current
      const table = tableRef.current
      const floatingHeader = floatingHeaderRef.current
      const scrollCue = scrollCueRef.current
      if (!scroller || !hero || !table || !floatingHeader || !scrollCue) {
        return
      }

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      const snapController = createHomeScrollSnapController({
        scroller,
        hero,
        table,
        input: inputRef.current,
        reducedMotion,
      })
      snapControllerRef.current = snapController
      if (pendingSnapRef.current === "table") {
        pendingSnapRef.current = null
        snapController.snapToTableReliably()
      } else if (pendingSnapRef.current === "hero") {
        pendingSnapRef.current = null
        snapController.snapTo("hero", { focusInput: true })
      } else if (pendingSnapRef.current) {
        snapController.snapTo(pendingSnapRef.current)
        pendingSnapRef.current = null
      }

      gsap.set(floatingHeader, { autoAlpha: 0, y: reducedMotion ? 0 : -8 })

      const destroySnapController = () => {
        snapController.destroy()
        if (snapControllerRef.current === snapController) {
          snapControllerRef.current = null
        }
      }

      if (reducedMotion) {
        const syncStaticScrollState = (progress: number) => {
          const hasReachedSessions = progress > 0
          gsap.set(floatingHeader, { autoAlpha: hasReachedSessions ? 1 : 0 })
          gsap.set(scrollCue, { autoAlpha: hasReachedSessions ? 0 : 1 })
        }

        const reducedMotionTrigger = ScrollTrigger.create({
          trigger: table,
          scroller,
          start: "top 92%",
          end: "top 18%",
          onRefresh: (trigger) => syncStaticScrollState(trigger.progress),
          onUpdate: (trigger) => syncStaticScrollState(trigger.progress),
        })

        ScrollTrigger.refresh()

        return () => {
          reducedMotionTrigger.kill()
          destroySnapController()
        }
      }

      gsap.to(scrollCue, {
        y: 8,
        duration: 1.2,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      })

      gsap
        .timeline({
          scrollTrigger: {
            trigger: table,
            scroller,
            start: "top 92%",
            end: "top 18%",
            scrub: 1.05,
          },
        })
        .to(scrollCue, { autoAlpha: 0, y: -18, scale: 0.92, duration: 0.35 }, 0)
        .to(floatingHeader, { autoAlpha: 1, y: 0, duration: 0.4 }, 0.04)
        .to(hero, { autoAlpha: 0.48, y: -34, scale: 0.975, duration: 0.4 }, 0)

      ScrollTrigger.refresh()

      return () => {
        destroySnapController()
      }
    },
    { dependencies: [enabled], scope: containerRef, revertOnUpdate: true },
  )

  const scrollToPreviousSessions = useCallback(() => {
    if (snapControllerRef.current) {
      snapControllerRef.current.snapToTableReliably()
      return
    }
    pendingSnapRef.current = "table"
  }, [])

  return {
    scrollToPreviousSessions: contextSafe(scrollToPreviousSessions),
    scrollToNewAgent: contextSafe(() => {
      if (snapControllerRef.current) {
        snapControllerRef.current.snapTo("hero", { focusInput: true })
        return
      }
      pendingSnapRef.current = "hero"
    }),
  }
}

function registerGsap() {
  if (gsapRegistered) {
    return
  }
  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, useGSAP)
  gsapRegistered = true
}

function createHomeScrollSnapController({
  scroller,
  hero,
  table,
  input,
  reducedMotion,
}: {
  scroller: HTMLDivElement
  hero: HTMLElement
  table: HTMLElement
  input: HTMLTextAreaElement | null
  reducedMotion: boolean
}): HomeScrollSnapController {
  let currentView: SnapView = inferCurrentView(scroller, hero, table)
  let isSnapping = false
  let snapTween: gsap.core.Tween | null = null
  let settleTimer: number | undefined
  let suppressSettleUntil = 0
  let reliableSnapTimers: number[] = []

  const clearSettleTimer = () => {
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer)
      settleTimer = undefined
    }
  }

  const stopSnap = () => {
    snapTween?.kill()
    snapTween = null
    isSnapping = false
  }

  const clearReliableSnapTimers = () => {
    for (const timer of reliableSnapTimers) {
      window.clearTimeout(timer)
    }
    reliableSnapTimers = []
  }

  const suppressSettle = (durationMs: number) => {
    suppressSettleUntil = Math.max(suppressSettleUntil, Date.now() + durationMs)
  }

  const snapTo = (view: SnapView, options: { focusInput?: boolean } = {}) => {
    clearSettleTimer()
    stopSnap()

    const target = view === "hero" ? hero : table
    const targetY = getTargetScrollTop(scroller, target)
    currentView = view

    if (reducedMotion) {
      scroller.scrollTo({ top: targetY, behavior: "auto" })
      if (options.focusInput) {
        input?.focus()
      }
      return
    }

    const distance = Math.abs(targetY - scroller.scrollTop)
    const duration = Math.min(0.82, Math.max(0.42, distance / 1400))
    isSnapping = true
    snapTween = gsap.to(scroller, {
      scrollTo: { y: targetY, autoKill: true },
      duration,
      ease: "power4.out",
      overwrite: "auto",
      onComplete: () => {
        isSnapping = false
        snapTween = null
        currentView = view
        if (options.focusInput) {
          input?.focus()
        }
      },
      onInterrupt: () => {
        isSnapping = false
        snapTween = null
      },
    })
  }

  const settle = () => {
    settleTimer = undefined
    if (isSnapping) {
      return
    }

    const heroY = getTargetScrollTop(scroller, hero)
    const tableY = getTargetScrollTop(scroller, table)
    const top = scroller.scrollTop
    const distance = tableY - heroY
    if (distance <= 0) {
      return
    }

    if (top <= heroY + 2) {
      currentView = "hero"
      return
    }

    if (top >= tableY) {
      currentView = "table"
      return
    }

    const threshold = distance * SNAP_THRESHOLD_RATIO
    const targetView =
      currentView === "hero"
        ? top >= heroY + threshold
          ? "table"
          : "hero"
        : top <= tableY - threshold
          ? "hero"
          : "table"

    snapTo(targetView)
  }

  const scheduleSettle = () => {
    if (isSnapping || Date.now() < suppressSettleUntil) {
      return
    }
    clearSettleTimer()
    settleTimer = window.setTimeout(settle, SNAP_SETTLE_DELAY_MS)
  }

  const snapToTableReliably = () => {
    clearReliableSnapTimers()
    suppressSettle(900)

    const attemptSnap = () => {
      ScrollTrigger.refresh()
      snapTo("table")
    }

    const scheduleAttempt = (delayMs: number) => {
      if (delayMs === 0) {
        attemptSnap()
        return
      }
      reliableSnapTimers.push(window.setTimeout(attemptSnap, delayMs))
    }

    const runWhenLayoutReady = (attempt: () => void) => {
      const scrollerHeight = scroller.clientHeight
      if (scrollerHeight > 0 && table.offsetHeight > 0) {
        attempt()
        return
      }

      requestAnimationFrame(() => {
        if (scroller.clientHeight > 0 && table.offsetHeight > 0) {
          attempt()
          return
        }
        requestAnimationFrame(attempt)
      })
    }

    runWhenLayoutReady(() => {
      scheduleAttempt(0)
      scheduleAttempt(120)
      scheduleAttempt(320)
    })
  }

  const cancelSnapForUserIntent = (event: KeyboardEvent | Event) => {
    if (
      event instanceof KeyboardEvent &&
      !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)
    ) {
      return
    }
    if (isSnapping) {
      stopSnap()
    }
  }

  scroller.addEventListener("scroll", scheduleSettle, { passive: true })
  scroller.addEventListener("wheel", cancelSnapForUserIntent, { passive: true })
  scroller.addEventListener("touchstart", cancelSnapForUserIntent, { passive: true })
  window.addEventListener("keydown", cancelSnapForUserIntent)

  return {
    snapTo,
    snapToTableReliably,
    destroy: () => {
      clearReliableSnapTimers()
      clearSettleTimer()
      stopSnap()
      scroller.removeEventListener("scroll", scheduleSettle)
      scroller.removeEventListener("wheel", cancelSnapForUserIntent)
      scroller.removeEventListener("touchstart", cancelSnapForUserIntent)
      window.removeEventListener("keydown", cancelSnapForUserIntent)
    },
  }
}

function inferCurrentView(
  scroller: HTMLDivElement,
  hero: HTMLElement,
  table: HTMLElement,
): SnapView {
  const heroY = getTargetScrollTop(scroller, hero)
  const tableY = getTargetScrollTop(scroller, table)
  return Math.abs(scroller.scrollTop - heroY) <= Math.abs(scroller.scrollTop - tableY)
    ? "hero"
    : "table"
}

function getTargetScrollTop(scroller: HTMLDivElement, target: HTMLElement): number {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetY = scroller.scrollTop + targetRect.top - scrollerRect.top
  const maxScroll = scroller.scrollHeight - scroller.clientHeight
  return Math.max(0, Math.min(maxScroll, targetY))
}
