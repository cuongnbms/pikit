import test, { after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import install, { cleanModelTitle, deriveTitle, firstPrompt, firstPromptTitle } from "../agent/extensions/task-title/index.ts"

// Keep personal configuration out of regression tests.
const previousAgentDir = process.env.PI_CODING_AGENT_DIR
const testAgentDir = mkdtempSync(join(tmpdir(), "pikit-title-default-"))
process.env.PI_CODING_AGENT_DIR = testAgentDir
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir
  rmSync(testAgentDir, { recursive: true, force: true })
})

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

async function withConfig(raw, run) {
  const dir = mkdtempSync(join(tmpdir(), "pikit-title-"))
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = dir
  mkdirSync(join(dir, "configs"))
  if (raw !== undefined) writeFileSync(join(dir, "configs", "task-title.json"), raw)
  try { await run() } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

const fakePi = () => {
  const handlers = {}
  const pi = { getThinkingLevel: () => "high", on: (event, handler) => { handlers[event] = handler } }
  return { pi, fire: (event, ctx, payload) => handlers[event]?.({ type: event, ...payload }, ctx) }
}

const fakeCtx = (entries, { sessionName, sessionId = "title-session", answer, fail } = {}) => {
  const titles = []
  const calls = []
  const warnings = []
  return {
    warnings,
    titles,
    calls,
    mode: "tui",
    model: { provider: "xai", id: "grok-4.6" },
    ui: { setTitle: (title) => titles.push(title), notify: (message, level) => warnings.push({ message, level }) },
    sessionManager: { getEntries: () => entries, getSessionName: () => sessionName, getSessionId: () => sessionId },
    modelRegistry: {
      streamSimple(model, context, options) {
        return { result: () => this.complete(model, context, options) }
      },
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

test("keeps the prompt title and warns when the model call fails", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")], { fail: true })
  fire("agent_start", ctx)
  await settle()
  assert.deepEqual(ctx.titles, ["dựng lại pipeline ingest"])
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0].message, /Task-title.*provider down/)
})

test("keeps the prompt title when the model answers with nothing usable", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([userEntry("dựng lại pipeline ingest")], { answer: "  " })
  fire("agent_start", ctx)
  await settle()
  assert.deepEqual(ctx.titles, ["dựng lại pipeline ingest"])
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0].message, /no usable title/i)
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

test("inherits the session effort through the provider-neutral API", async () => {
  const { pi, fire } = fakePi()
  install(pi)
  const ctx = fakeCtx([])
  fire("input", ctx, { text: "dựng lại pipeline ingest", source: "interactive" })
  await settle()
  assert.equal(ctx.calls[0].options.reasoning, "high")
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

test("uses the configured title model and effort without changing the session", async () => {
  await withConfig(JSON.stringify({ provider: "other", model: "title-model", effort: "low" }), async () => {
    const { pi, fire } = fakePi()
    const ctx = fakeCtx([])
    const titleModel = { provider: "other", id: "title-model" }
    ctx.modelRegistry.find = (provider, id) => provider === "other" && id === "title-model" ? titleModel : undefined
    install(pi)
    fire("input", ctx, { text: "my task", source: "interactive" })
    await settle()
    assert.deepEqual(ctx.calls[0].model, titleModel)
    assert.equal(ctx.calls[0].options.reasoning, "low")
    assert.deepEqual(ctx.model, { provider: "xai", id: "grok-4.6" })
    assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
  })
})

test("title requests through an alias carry the current session ID, including after replacement", async () => {
  await withConfig('{"provider":"alias","model":"fast"}', async () => {
    const { pi, fire } = fakePi()
    install(pi)
    const first = fakeCtx([], { sessionId: "session-before-switch" })
    first.modelRegistry.find = () => ({ provider: "alias", id: "fast" })
    fire("input", first, { text: "my first task", source: "interactive" })
    await settle()
    assert.deepEqual(first.calls[0].model, { provider: "alias", id: "fast" })
    assert.equal(first.calls[0].options.sessionId, "session-before-switch")
    assert.equal(first.titles.at(-1), "Dựng pipeline ingest")

    const next = fakeCtx([userEntry("my next task")], { sessionId: "session-after-switch" })
    next.modelRegistry.find = first.modelRegistry.find
    fire("session_start", next)
    await settle()
    assert.equal(next.calls[0].options.sessionId, "session-after-switch")
    assert.equal(next.titles.at(-1), "Dựng pipeline ingest")
    assert.deepEqual(next.warnings, [])
  })
})

test("an unknown configured model warns and discards its effort override", async () => {
  await withConfig('{"provider":"missing","model":"gone","effort":"low"}', async () => {
    const { pi, fire } = fakePi()
    const ctx = fakeCtx([])
    ctx.modelRegistry.find = () => undefined
    install(pi)
    fire("input", ctx, { text: "my task", source: "interactive" })
    await settle()
    assert.equal(ctx.warnings.length, 1)
    assert.match(ctx.warnings[0].message, /missing\/gone/)
    assert.deepEqual(ctx.calls[0].model, ctx.model)
    assert.equal(ctx.calls[0].options.reasoning, "high")
    assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
  })
})

test("a resolved provider error warns and never installs its partial text as title", async () => {
  const { pi, fire } = fakePi()
  const ctx = fakeCtx([])
  ctx.modelRegistry.complete = async () => ({
    stopReason: "error", errorMessage: "Unsupported reasoning effort",
    content: [{ type: "text", text: "Incomplete output" }],
  })
  install(pi)
  fire("input", ctx, { text: "my task", source: "interactive" })
  await settle()
  assert.deepEqual(ctx.titles, ["my task"])
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0].message, /Unsupported reasoning effort/)
})

test("an aborted title response warns and keeps the prompt instead of partial text", async () => {
  const { pi, fire } = fakePi()
  const ctx = fakeCtx([])
  ctx.modelRegistry.complete = async () => ({
    stopReason: "aborted", errorMessage: "Title request timed out",
    content: [{ type: "text", text: "Partial title" }],
  })
  install(pi)
  fire("input", ctx, { text: "my task", source: "interactive" })
  await settle()
  assert.deepEqual(ctx.titles, ["my task"])
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0].message, /timed out/)
})

test("errors from shut down or replaced sessions never emit stale warnings", async () => {
  for (const replacement of [false, true]) {
    const { pi, fire } = fakePi()
    const old = fakeCtx([])
    let rejectOld
    old.modelRegistry.complete = () => new Promise((_resolve, reject) => { rejectOld = reject })
    install(pi)
    fire("input", old, { text: "old task", source: "interactive" })
    await settle()
    const current = fakeCtx([userEntry("new task")], { answer: "New title" })
    if (replacement) fire("session_start", current)
    else fire("session_shutdown", old)
    rejectOld(new Error("Old provider error"))
    await settle()
    assert.deepEqual(old.titles, ["old task"])
    assert.deepEqual(old.warnings, [])
    assert.deepEqual(current.warnings, [])
    if (replacement) assert.equal(current.titles.at(-1), "New title")
  }
})

test("model-only config inherits live effort, including off", async () => {
  await withConfig('{"provider":"other","model":"title-model"}', async () => {
    for (const [effort, expected] of [["medium", "medium"], ["off", undefined]]) {
      const { pi, fire } = fakePi()
      pi.getThinkingLevel = () => effort
      const ctx = fakeCtx([])
      ctx.modelRegistry.find = () => ({ provider: "other", id: "title-model" })
      install(pi)
      fire("input", ctx, { text: "my task", source: "interactive" })
      await settle()
      assert.equal(ctx.calls[0].options.reasoning, expected)
      assert.deepEqual(ctx.calls[0].model, { provider: "other", id: "title-model" })
      assert.equal(ctx.warnings.length, 0)
      assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
    }
  })
})

test("effort-only config keeps the session model", async () => {
  await withConfig('{"effort":"low"}', async () => {
    const { pi, fire } = fakePi()
    const ctx = fakeCtx([])
    install(pi)
    fire("input", ctx, { text: "my task", source: "interactive" })
    await settle()
    assert.deepEqual(ctx.calls[0].model, ctx.model)
    assert.equal(ctx.calls[0].options.reasoning, "low")
    assert.equal(ctx.warnings.length, 0)
    assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
  })
})

test("a missing session model keeps the prompt title and warns", async () => {
  const { pi, fire } = fakePi()
  const ctx = fakeCtx([])
  ctx.model = undefined
  install(pi)
  fire("input", ctx, { text: "my task", source: "interactive" })
  await settle()
  assert.deepEqual(ctx.titles, ["my task"])
  assert.equal(ctx.calls.length, 0)
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0].message, /no model/i)
})

test("warns and uses session defaults for malformed title configuration", async () => {
  for (const raw of ["{", "null", "[]", '{"effort":"turbo"}', '{"model":"unpaired"}', '{"provider":" "}']) {
    await withConfig(raw, async () => {
      const { pi, fire } = fakePi()
      const ctx = fakeCtx([])
      install(pi)
      fire("input", ctx, { text: "my task", source: "interactive" })
      await settle()
      assert.equal(ctx.warnings.length, 1, raw)
      assert.equal(ctx.warnings[0].level, "warning")
      assert.match(ctx.warnings[0].message, /task-title.*config/i)
      assert.deepEqual(ctx.calls[0].model, ctx.model)
      assert.equal(ctx.calls[0].options.reasoning, "high")
      assert.equal(ctx.titles.at(-1), "Dựng pipeline ingest")
    })
  }
})
