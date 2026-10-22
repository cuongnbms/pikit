# Task title

Integrated from `pi-task-title`. Gives each interactive terminal tab a title based
on the session's first task instead of the same project name in every tab.

## Behavior

- Shows the first nonblank line of the first task immediately, collapsing whitespace
  and truncating to 50 characters with an ellipsis.
- Makes one background request for a title of at most six words in the task's
  language. By default it uses the session's current model and thinking effort at
  request start; both can be overridden below. This is an additional model request
  and may incur provider usage charges. The full first prompt is sent to that model.
- Keeps the prompt title and shows a warning when the model is unavailable, fails,
  returns no usable text, or reaches the 45-second request timeout.
- Leaves later prompts alone and restores the task title after Pi updates session info.
- Recovers the first task from session history on resume or reload (and requests a
  fresh model title; generated titles are not persisted).
- Respects named sessions: `/name <name>` leaves Pi in charge of the title.
- Ignores slash commands, bash lines, and extension-originated input events.
- Runs only in interactive terminal mode, not RPC, JSON, or print mode.
- Cancels outstanding title requests on session shutdown/replacement and ignores stale
  responses or queued updates from the old session.

## Model and effort configuration

Optional: create `~/.pi/agent/configs/task-title.json` (or
`$PI_CODING_AGENT_DIR/configs/task-title.json` when using a custom agent directory):

```json
{
  "provider": "openai",
  "model": "gpt-6.1-sol",
  "effort": "low"
}
```

- Omit the file or use `{}` to inherit the current session model and effort.
- `provider` and `model` must be supplied together; use their exact registry IDs.
  This only changes title generation, never the session model.
- `effort` is optional, independently of the model override. Valid values are
  `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Omitting `effort` inherits the current session effort, even with a custom title
  model. Pi's provider-neutral API adapts the effort to the selected model's
  supported levels; it does not force `minimal`.
- Invalid configuration or an unknown model produces a warning and falls back to
  **both** the session model and effort. A provider request failure instead keeps
  the prompt title; it does not send another request using a different model.
- Configuration is read when each session's title request starts. Changing it does
  not retry an existing request; use `/reload` or start a new session to apply it.
- No configuration file is created automatically. Errors from a replaced or shut
  down session do not produce stale warnings.

## Install and reload

Included automatically with Pikit; no extra dependency or settings are needed.
After updating a local Pikit installation, run `/reload` or restart Pi.

If the standalone `pi-task-title.ts` is already installed in
`~/.pi/agent/extensions/` or explicitly listed in your settings, disable or remove
that copy before enabling this one. Loading both makes them compete for the title
and duplicates model requests. Pikit does not change personal configuration or
remove the standalone file automatically.

## Tests

From the Pikit root:

```sh
node --test tests/task-title.test.mjs
pnpm test
pnpm check
```
