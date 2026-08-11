/**
 * Task extraction utilities for parsing TodoWrite events
 */

import type { SandboxEvent } from "@solzero/shared"
import type { Task } from "@/types/session"

interface TodoWriteArgs {
  todos?: Array<{
    content: string
    status: "pending" | "in_progress" | "completed"
    activeForm?: string
  }>
}

export function extractLatestTasks(events: SandboxEvent[]): Task[] {
  const todoWriteEvents = events
    .filter((event) => event.type === "tool_call" && event.tool === "TodoWrite")
    .sort((a, b) => b.timestamp - a.timestamp)

  if (todoWriteEvents.length === 0) {
    return []
  }

  const latestTodoWrite = todoWriteEvents[0]
  const args = latestTodoWrite.args as TodoWriteArgs | undefined

  if (!args?.todos || !Array.isArray(args.todos)) {
    return []
  }

  return args.todos.map((todo) => ({
    content: todo.content || "",
    status: todo.status || "pending",
    activeForm: todo.activeForm,
  }))
}

export function getTaskCounts(tasks: Task[]): {
  total: number
  pending: number
  inProgress: number
  completed: number
} {
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  }
}

export function getCurrentTask(tasks: Task[]): Task | null {
  return tasks.find((t) => t.status === "in_progress") || null
}
