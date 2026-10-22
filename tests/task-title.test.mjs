import test from "node:test"
import assert from "node:assert/strict"

import install, { cleanModelTitle, deriveTitle, firstPrompt, firstPromptTitle } from "../agent/extensions/task-title/index.ts"

test("keeps a short prompt as the title", () => {
  assert.equal(deriveTitle("chạy tất cả lên để test"), "chạy tất cả lên để test")
})

test("takes only the first line of a multi-line prompt", () => {
  assert.equal(deriveTitle("sửa lỗi login\n\nchi tiết ở file auth.ts"), "sửa lỗi login")
})

test("skips leading blank lines", () => {
  assert.equal(deriveTitle("\n\n  sửa lỗi login"), "sửa lỗi login")
})

test("collapses runs of whitespace inside the line", () => {
  assert.equal(deriveTitle("sửa    lỗi\tlogin"), "sửa lỗi login")
})

test("truncates a long prompt to 50 characters with an ellipsis", () => {
  const title = deriveTitle("a".repeat(80))
  assert.equal(title, `${"a".repeat(49)}…`)
  assert.equal(title.length, 50)
})

test("ignores a slash command", () => {
  assert.equal(deriveTitle("/name my-session"), null)
})

test("ignores a bash line", () => {
  assert.equal(deriveTitle("!ls -la"), null)
})

test("ignores a blank prompt", () => {
  assert.equal(deriveTitle("   \n  "), null)
})

test("ignores a non-string prompt", () => {
  assert.equal(deriveTitle(undefined), null)
})

test("strips the quotes a model wraps its answer in", () => {
  assert.equal(cleanModelTitle('"Sửa pipeline ingest".'), "Sửa pipeline ingest")
})

test("strips the backticks a model wraps its answer in", () => {
  assert.equal(cleanModelTitle("`Sửa pipeline ingest`"), "Sửa pipeline ingest")
})

test("takes the first line when a model answers with several", () => {
  assert.equal(cleanModelTitle("Sửa pipeline ingest\n\n(6 từ)"), "Sửa pipeline ingest")
})

test("has no title when a model answers with nothing", () => {
  assert.equal(cleanModelTitle("   "), null)
})

const userEntry = (text) => ({
  type: "message",
  message: { role: "user", content: [{ type: "text", text }] },
})

const ctxWith = (entries) => ({ sessionManager: { getEntries: () => entries } })

test("titles a session from its first user message", () => {
  const ctx = ctxWith([userEntry("dựng lại pipeline ingest"), userEntry("chạy test đi")])
  assert.equal(firstPromptTitle(ctx), "dựng lại pipeline ingest")
})

test("looks past entries that are not messages", () => {
  const ctx = ctxWith([
    { type: "model_change", provider: "xai", modelId: "grok-4.6" },
    userEntry("dựng lại pipeline ingest"),
  ])
  assert.equal(firstPromptTitle(ctx), "dựng lại pipeline ingest")
})

test("looks past assistant messages", () => {
  const ctx = ctxWith([
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "xong rồi" }] } },
    userEntry("dựng lại pipeline ingest"),
  ])
  assert.equal(firstPromptTitle(ctx), "dựng lại pipeline ingest")
})

test("looks past a user message that is only a slash command", () => {
  const ctx = ctxWith([userEntry("/model grok-4.6"), userEntry("dựng lại pipeline ingest")])
  assert.equal(firstPromptTitle(ctx), "dựng lại pipeline ingest")
})

test("reads a message whose content is plain text", () => {
  const ctx = ctxWith([{ type: "message", message: { role: "user", content: "chạy test đi" } }])
  assert.equal(firstPromptTitle(ctx), "chạy test đi")
})

test("has no title for a session with no user message yet", () => {
  assert.equal(firstPromptTitle(ctxWith([])), null)
})

test("has no title when the session manager is missing", () => {
  assert.equal(firstPromptTitle({}), null)
})

test("keeps the whole prompt, untruncated, for the model to read", () => {
  const prompt = `dựng lại pipeline ingest ${"x".repeat(80)}`
  assert.equal(firstPrompt(ctxWith([userEntry(prompt)])), prompt)
})

const fakePi = () => {
  const handlers = {}
  const pi = { on: (event, handler) => { handlers[event] = handler } }
  return { pi, fire: (event, ctx, payload) => handlers[event]?.({ type: event, ...payload }, ctx) }
}

const fakeCtx = (entries, { sessionName, answer, fail } = {}) => {
  const titles = []
  const calls = []
  return {
    titles,
    calls,
    mode: "tui",
    model: { provider: "xai", id: "grok-4.6" },
    ui: { setTitle: (title) => titles.push(title) },
    sessionManager: { getEntries: () => entries, getSessionName: () => sessionName },
    modelRegistry: {
      complete: async (model, context, options) => {
        calls.push({ model, context, options })
        if (fail) throw new Error("provider down")
        return { content: [{ type: "text", text: answer ?? "Dựng pipeline ingest" }] }
      },
    },
  }
}

// Why: the extension defers setTitle by a macrotask so pi's own
// updateTerminalTitle() cannot land on top of it, and the model answer
// arrives a promise later. Two turns of the loop cover both.
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("titles the terminal from the prompt as soon as the agent starts", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest cho xong")])
  fire("agent_start", ctx)
  await settle()
  assert.equal(ctx.titles[0], "dựng lại pipeline ingest cho xong")
})

test("replaces the prompt title with the model's shorter one", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest cho xong")], { answer: "Dựng pipeline ingest" })
  fire("agent_start", ctx)
  await settle()
  assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
})

test("sends the whole prompt to the model", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const prompt = `dựng lại pipeline ingest ${"x".repeat(80)}`
  const ctx = fakeCtx([userEntry(prompt)])
  fire("agent_start", ctx)
  await settle()
  assert.equal(ctx.calls[0].context.messages[0].content[0].text.includes(prompt), true)
})

test("asks the session's own model", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")])
  fire("agent_start", ctx)
  await settle()
  assert.deepEqual(ctx.calls[0].model, { provider: "xai", id: "grok-4.6" })
})

test("keeps the prompt title when the model call fails", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")], { fail: true })
  fire("agent_start", ctx)
  await settle()
  assert.deepEqual(ctx.titles, ["dựng lại pipeline ingest"])
})

test("keeps the prompt title when the model answers with nothing usable", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")], { answer: "  " })
  fire("agent_start", ctx)
  await settle()
  assert.deepEqual(ctx.titles, ["dựng lại pipeline ingest"])
})

test("asks the model only once per session", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const entries = [userEntry("dựng lại pipeline ingest")]
  const ctx = fakeCtx(entries)
  fire("agent_start", ctx)
  await settle()
  entries.push(userEntry("giờ sửa test đi"))
  fire("agent_start", ctx)
  await settle()
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
})

test("titles the terminal on resume, before any new prompt", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")])
  fire("session_start", ctx)
  await settle()
  assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
})

test("leaves the title alone when the session has a name", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")], { sessionName: "ingest" })
  fire("agent_start", ctx)
  await settle()
  assert.deepEqual(ctx.titles, [])
  assert.equal(ctx.calls.length, 0)
})

test("puts the title back after pi resets it", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")])
  fire("agent_start", ctx)
  await settle()
  ctx.titles.length = 0
  fire("session_info_changed", ctx)
  await settle()
  assert.deepEqual(ctx.titles, ["Dựng pipeline ingest"])
})

test("titles a different session from its own first prompt", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  fire("agent_start", fakeCtx([userEntry("dựng lại pipeline ingest")]))
  await settle()
  const second = fakeCtx([userEntry("kiểm tra mme trên server")], { answer: "Kiểm tra MME" })
  fire("session_start", second)
  await settle()
  assert.equal(second.titles.at(-1), "Kiểm tra MME")
})

test("titles the terminal from the input, before the session records it", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "dựng lại pipeline ingest cho xong", source: "interactive" })
  await settle()
  assert.equal(ctx.titles[0], "dựng lại pipeline ingest cho xong")
  assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
})

test("sends the input the model has not seen in the session yet", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "dựng lại pipeline ingest", source: "interactive" })
  await settle()
  assert.equal(ctx.calls[0].context.messages[0].content[0].text, "dựng lại pipeline ingest")
})

test("lets the input through untouched", () => {
  const { pi, fire } = fakePi()
  install(pi)
  const result = fire("input", fakeCtx([]), { text: "dựng lại pipeline ingest", source: "interactive" })
  assert.deepEqual(result, { action: "continue" })
})

test("ignores input that an extension injected", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "chạy lại build đi", source: "extension" })
  await settle()
  assert.deepEqual(ctx.titles, [])
  assert.equal(ctx.calls.length, 0)
})

test("ignores a slash command typed as input", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "/model grok-4.6", source: "interactive" })
  await settle()
  assert.deepEqual(ctx.titles, [])
  assert.equal(ctx.calls.length, 0)
})

test("keeps the title of the first input when a second one arrives", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "dựng lại pipeline ingest", source: "interactive" })
  await settle()
  fire("input", ctx, { text: "giờ sửa test đi", source: "interactive" })
  await settle()
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
})

test("asks for a title without letting the model think at length", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "dựng lại pipeline ingest", source: "interactive" })
  await settle()
  assert.equal(ctx.calls[0].options.reasoningEffort, "minimal")
})

test("shutdown cancels the model request and discards queued title updates", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  let finish
  let signal
  ctx.modelRegistry.complete = (_model, _context, options) => {
    signal = options.signal
    return new Promise((resolve) => { finish = resolve })
  }
  fire("input", ctx, { text: "my task", source: "interactive" })
  fire("session_shutdown", ctx)
  assert.equal(signal.aborted, true)
  finish({ content: [{ type: "text", text: "Late title" }] })
  await settle()
  assert.deepEqual(ctx.titles, [])
})

test("non-terminal modes do not request or set a task title", async () => {
  for (const mode of ["rpc", "json", "print"]) {
    const { pi, fire } = fakePi()
    install(pi)
    const ctx = fakeCtx([])
    ctx.mode = mode
    fire("input", ctx, { text: "my task", source: "interactive" })
    await settle()
    assert.deepEqual(ctx.titles, [], mode)
    assert.equal(ctx.calls.length, 0, mode)
  }
})

test("a deferred title does not overwrite a newly named session", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "my task", source: "interactive" })
  ctx.sessionManager.getSessionName = () => "manual name"
  await settle()
  assert.deepEqual(ctx.titles, [])
})

test("ignores a model answer from a session that was replaced", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  let resolveOld
  const old = fakeCtx([])
  old.modelRegistry.complete = () => new Promise((resolve) => { resolveOld = resolve })
  fire("input", old, { text: "old task", source: "interactive" })
  await settle()
  const current = fakeCtx([userEntry("new task")], { answer: "New title" })
  fire("session_start", current)
  await settle()
  old.titles.length = 0
  resolveOld({ content: [{ type: "text", text: "Old title" }] })
  await settle()
  fire("session_info_changed", current)
  await settle()
  assert.deepEqual(old.titles, [])
  assert.equal(current.titles.at(-1), "New title")
})

test("prefers the session's own first prompt over a later input", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")], { answer: "Dựng pipeline ingest" })
  fire("input", ctx, { text: "giờ sửa test đi", source: "interactive" })
  await settle()
  assert.equal(ctx.titles[0], "dựng lại pipeline ingest")
  assert.equal(ctx.calls[0].context.messages[0].content[0].text, "dựng lại pipeline ingest")
})
