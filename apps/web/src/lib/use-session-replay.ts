"use client"

import type { SandboxEvent } from "@solzero/shared"
import { useCallback, useEffect, useRef, useState } from "react"
import { formatExecutionDuration } from "@/lib/session-events"
import { showWarningToast } from "@/lib/toast-manager"

const FAST_FORWARD_THRESHOLD_MS = 15_000
const FAST_FORWARD_DELAY_MS = 600

type ReplayState = {
  isReplaying: boolean
  isPaused: boolean
  events: SandboxEvent[]
  isProcessing: boolean
}

export function useSessionReplay(recordedEvents: SandboxEvent[]) {
  const recordedEventsRef = useRef(recordedEvents)
  const replayEventsRef = useRef<SandboxEvent[]>([])
  const isReplayingRef = useRef(false)
  const isPausedRef = useRef(false)
  const currentIndexRef = useRef(0)
  const timerStartedAtRef = useRef<number | null>(null)
  const timerDelayMsRef = useRef<number | null>(null)
  const remainingDelayMsRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, setState] = useState<ReplayState>({
    isReplaying: false,
    isPaused: false,
    events: [],
    isProcessing: false,
  })

  useEffect(() => {
    const recordedEventsChanged = recordedEventsRef.current !== recordedEvents
    recordedEventsRef.current = recordedEvents
    if (!recordedEventsChanged || !isReplayingRef.current) {
      return
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    isReplayingRef.current = false
    isPausedRef.current = false
    replayEventsRef.current = []
    currentIndexRef.current = 0
    timerStartedAtRef.current = null
    timerDelayMsRef.current = null
    remainingDelayMsRef.current = null
    setState({
      isReplaying: false,
      isPaused: false,
      events: [],
      isProcessing: false,
    })
  }, [recordedEvents])

  const clearReplayTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    timerStartedAtRef.current = null
    timerDelayMsRef.current = null
  }, [])

  const stop = useCallback(() => {
    clearReplayTimer()
    isReplayingRef.current = false
    isPausedRef.current = false
    replayEventsRef.current = []
    currentIndexRef.current = 0
    remainingDelayMsRef.current = null
    setState({
      isReplaying: false,
      isPaused: false,
      events: [],
      isProcessing: false,
    })
  }, [clearReplayTimer])

  const scheduleNextEvent = useCallback((currentIndex: number, overrideWaitMs?: number) => {
    const replayEvents = replayEventsRef.current
    const nextIndex = currentIndex + 1
    const currentEvent = replayEvents[currentIndex]
    const nextEvent = replayEvents[nextIndex]

    if (!currentEvent || !nextEvent) {
      isReplayingRef.current = false
      isPausedRef.current = false
      replayEventsRef.current = []
      currentIndexRef.current = 0
      remainingDelayMsRef.current = null
      setState({
        isReplaying: false,
        isPaused: false,
        events: [],
        isProcessing: false,
      })
      return
    }

    const rawDelayMs = (nextEvent.timestamp - currentEvent.timestamp) * 1000
    const waitMs = overrideWaitMs ?? Math.max(0, Math.round(rawDelayMs))
    const shouldFastForward = overrideWaitMs === undefined && waitMs > FAST_FORWARD_THRESHOLD_MS

    if (shouldFastForward) {
      showWarningToast("Fast-forwarding replay", {
        description: `Actual wait was ${formatExecutionDuration(waitMs)}.`,
      })
    }

    const scheduledWaitMs = shouldFastForward ? FAST_FORWARD_DELAY_MS : waitMs
    remainingDelayMsRef.current = scheduledWaitMs
    timerStartedAtRef.current = Date.now()
    timerDelayMsRef.current = scheduledWaitMs

    setState((current) => ({
      ...current,
      isProcessing: nextEvent.type !== "user_message",
    }))

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      timerStartedAtRef.current = null
      timerDelayMsRef.current = null
      remainingDelayMsRef.current = null
      currentIndexRef.current = nextIndex
      setState((current) => ({
        ...current,
        events: replayEvents.slice(0, nextIndex + 1),
      }))
      scheduleNextEvent(nextIndex)
    }, scheduledWaitMs)
  }, [])

  const start = useCallback(() => {
    clearReplayTimer()
    const replayEvents = [...recordedEventsRef.current]
    isReplayingRef.current = replayEvents.length > 0
    isPausedRef.current = false
    replayEventsRef.current = replayEvents
    currentIndexRef.current = 0
    remainingDelayMsRef.current = null

    if (replayEvents.length === 0) {
      setState({
        isReplaying: false,
        isPaused: false,
        events: [],
        isProcessing: false,
      })
      return
    }

    setState({
      isReplaying: true,
      isPaused: false,
      events: replayEvents.slice(0, 1),
      isProcessing: replayEvents[1]?.type !== "user_message" && replayEvents.length > 1,
    })
    scheduleNextEvent(0)
  }, [clearReplayTimer, scheduleNextEvent])

  const pause = useCallback(() => {
    if (!isReplayingRef.current || isPausedRef.current) {
      return
    }

    const elapsedMs =
      timerStartedAtRef.current === null ? 0 : Date.now() - timerStartedAtRef.current
    remainingDelayMsRef.current =
      timerDelayMsRef.current === null ? 0 : Math.max(0, timerDelayMsRef.current - elapsedMs)

    clearReplayTimer()
    isPausedRef.current = true
    setState((current) =>
      current.isReplaying ? { ...current, isPaused: true, isProcessing: false } : current,
    )
  }, [clearReplayTimer])

  const resume = useCallback(() => {
    if (!isReplayingRef.current || !isPausedRef.current) {
      return
    }

    const remainingDelayMs = remainingDelayMsRef.current ?? 0
    isPausedRef.current = false
    remainingDelayMsRef.current = null
    setState((current) => ({ ...current, isPaused: false }))
    scheduleNextEvent(currentIndexRef.current, remainingDelayMs)
  }, [scheduleNextEvent])

  const togglePause = useCallback(() => {
    if (isPausedRef.current) {
      resume()
      return
    }

    pause()
  }, [pause, resume])

  useEffect(
    () => () => {
      clearReplayTimer()
      isReplayingRef.current = false
      isPausedRef.current = false
      replayEventsRef.current = []
      currentIndexRef.current = 0
      remainingDelayMsRef.current = null
    },
    [clearReplayTimer],
  )

  return {
    isReplaying: state.isReplaying,
    isPaused: state.isPaused,
    events: state.events,
    isProcessing: state.isProcessing,
    start,
    stop,
    pause,
    resume,
    togglePause,
  }
}
