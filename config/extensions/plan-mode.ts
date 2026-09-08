import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"]
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"]
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"])
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS])

const TOGGLE_SHORTCUT = "tab"

interface TodoItem {
  step: number
  text: string
  completed: boolean
}

interface PlanModeState {
  enabled: boolean
  todos?: TodoItem[]
  executing?: boolean
  toolsBeforePlanMode?: string[]
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray(m.content)
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
}

function cleanStepText(text: string): string {
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }
  if (cleaned.length > 50) {
    cleaned = cleaned.slice(0, 47) + "..."
  }
  return cleaned
}

function extractTodoItems(message: string): TodoItem[] {
  const items: TodoItem[] = []
  const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i)
  if (!headerMatch) return items

  const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length)
  const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm

  for (const match of planSection.matchAll(numberedPattern)) {
    const text = match[2]
      .trim()
      .replace(/\*{1,2}$/, "")
      .trim()
    if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
      const cleaned = cleanStepText(text)
      if (cleaned.length > 3) {
        items.push({ step: items.length + 1, text: cleaned, completed: false })
      }
    }
  }
  return items
}

function extractDoneSteps(message: string): number[] {
  const steps: number[] = []
  for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1])
    if (Number.isFinite(step)) steps.push(step)
  }
  return steps
}

function markCompletedSteps(text: string, items: TodoItem[]): number {
  const doneSteps = extractDoneSteps(text)
  for (const step of doneSteps) {
    const item = items.find((t) => t.step === step)
    if (item) item.completed = true
  }
  return doneSteps.length
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = true
  let executionMode = false
  let todoItems: TodoItem[] = []
  let toolsBeforePlanMode: string[] | undefined

  function updateStatus(ctx: ExtensionContext): void {
    if (executionMode && todoItems.length > 0) {
      const completed = todoItems.filter((t) => t.completed).length
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`))
    } else if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"))
    } else {
      ctx.ui.setStatus("plan-mode", undefined)
    }

    if (executionMode && todoItems.length > 0) {
      const lines = todoItems.map((item) => {
        if (item.completed) {
          return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
        }
        return ctx.ui.theme.fg("muted", "☐ ") + item.text
      })
      ctx.ui.setWidget("plan-todos", lines)
    } else {
      ctx.ui.setWidget("plan-todos", undefined)
    }
  }

  function uniqueToolNames(toolNames: string[]): string[] {
    return [...new Set(toolNames)]
  }

  function getPlanModeTools(activeToolNames: string[]): string[] {
    return uniqueToolNames([
      ...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
      ...PLAN_MODE_TOOLS,
    ])
  }

  function getNormalModeTools(activeToolNames: string[]): string[] {
    return uniqueToolNames([
      ...NORMAL_MODE_TOOLS,
      ...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
    ])
  }

  function enablePlanModeTools(): void {
    if (toolsBeforePlanMode === undefined) {
      toolsBeforePlanMode = pi.getActiveTools()
    }
    pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode))
  }

  function restoreNormalModeTools(): void {
    pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()))
    toolsBeforePlanMode = undefined
  }

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
      toolsBeforePlanMode,
    })
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = !planModeEnabled
    executionMode = false
    todoItems = []

    if (planModeEnabled) {
      enablePlanModeTools()
      ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.")
    } else {
      restoreNormalModeTools()
      ctx.ui.notify("Plan mode disabled. Full access restored.")
    }
    updateStatus(ctx)
    persistState()
  }

  pi.registerCommand("plan", {
    description: "Toggle plan mode (read-only exploration)",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  })

  pi.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (todoItems.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan", "info")
        return
      }
      const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n")
      ctx.ui.notify(`Plan Progress:\n${list}`, "info")
    },
  })

  pi.registerShortcut(TOGGLE_SHORTCUT, {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  })

  pi.on("context", async (event) => {
    if (planModeEnabled) return

    return {
      messages: event.messages.filter((m) => {
        const msg = m as AgentMessage & { customType?: string }
        if (msg.customType === "plan-mode-context") return false
        if (msg.role !== "user") return true

        const content = msg.content
        if (typeof content === "string") {
          return !content.includes("[PLAN MODE ACTIVE]")
        }
        if (Array.isArray(content)) {
          return !content.some((c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"))
        }
        return true
      }),
    }
  })

  pi.on("before_agent_start", async () => {
    if (planModeEnabled) {
      return {
        message: {
          customType: "plan-mode-context",
          content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode.

Restrictions:
- Built-in edit and write tools are disabled
- Bash is for reading only (grep, ls, git log, cat...) - never modify anything

Ask clarifying questions if anything is unsure.

If the request only asks a question about the code, just answer it.

If the request requires changes, investigate as needed and produce a
numbered plan under a "Plan:" header with concrete, actionable steps -
the plan will be executed after approval:

Plan:
1. First step description
2. Second step description
...`,
          display: false,
        },
      }
    }

    if (executionMode && todoItems.length > 0) {
      const remaining = todoItems.filter((t) => !t.completed)
      const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n")
      return {
        message: {
          customType: "plan-execution-context",
          content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
          display: false,
        },
      }
    }
  })

  pi.on("turn_end", async (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return
    if (!isAssistantMessage(event.message)) return

    const text = getTextContent(event.message)
    if (markCompletedSteps(text, todoItems) > 0) {
      updateStatus(ctx)
    }
    persistState()
  })

  pi.on("agent_end", async (event, ctx) => {
    if (executionMode && todoItems.length > 0) {
      if (todoItems.every((t) => t.completed)) {
        const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n")
        pi.sendMessage(
          { customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
          { triggerTurn: false },
        )
        executionMode = false
        todoItems = []
        updateStatus(ctx)
        persistState()
      }
      return
    }

    if (!planModeEnabled || !ctx.hasUI) return

    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage)
    if (lastAssistant) {
      const extracted = extractTodoItems(getTextContent(lastAssistant))
      if (extracted.length > 0) {
        todoItems = extracted
      }
    }

    if (todoItems.length === 0) return
    persistState()

    const choice = await ctx.ui.select("Plan mode - what next?", [
      "Execute the plan (track progress)",
      "Stay in plan mode",
      "Refine the plan",
    ])

    if (choice?.startsWith("Execute")) {
      const firstTodoItem = todoItems[0]
      if (!firstTodoItem) return

      planModeEnabled = false
      executionMode = true
      restoreNormalModeTools()
      updateStatus(ctx)
      persistState()

      const execMessage = `Execute the plan.

Start with: ${firstTodoItem.text}
After completing a step, include a [DONE:n] tag in your response.`
      pi.sendMessage(
        { customType: "plan-mode-execute", content: execMessage, display: true },
        { triggerTurn: true, deliverAs: "followUp" },
      )
    } else if (choice === "Refine the plan") {
      const refinement = await ctx.ui.editor("Refine the plan:", "")
      if (refinement?.trim()) {
        pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" })
      }
    }
  })

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries()

    const planModeEntry = entries
      .filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
      .pop() as { data?: PlanModeState } | undefined

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled
      todoItems = planModeEntry.data.todos ?? todoItems
      executionMode = planModeEntry.data.executing ?? executionMode
      toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode
    }

    const isResume = planModeEntry !== undefined
    if (isResume && executionMode && todoItems.length > 0) {
      let executeIndex = -1
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as { type: string; customType?: string }
        if (entry.customType === "plan-mode-execute") {
          executeIndex = i
          break
        }
      }

      const messages: AssistantMessage[] = []
      for (let i = executeIndex + 1; i < entries.length; i++) {
        const entry = entries[i]
        if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
          messages.push(entry.message as AssistantMessage)
        }
      }
      const allText = messages.map(getTextContent).join("\n")
      markCompletedSteps(allText, todoItems)
    }

    if (planModeEnabled) {
      enablePlanModeTools()
    }
    updateStatus(ctx)
  })
}
