# Task title

Integrated from `pi-task-title`. Gives each interactive terminal tab a title based
on the session's first task instead of the same project name in every tab.

## Behavior

- Shows the first nonblank line of the first task immediately, collapsing whitespace
  and truncating to 50 characters with an ellipsis.
- Makes one background request to the session's current model for a title of at most
  six words in the task's language. This is an additional model request and may incur
  provider usage charges. The full first prompt is sent to that model.
- Keeps the prompt title when the model is unavailable, fails, returns no usable text,
  or reaches the 45-second request timeout.
- Leaves later prompts alone and restores the task title after Pi updates session info.
- Recovers the first task from session history on resume or reload (and requests a
  fresh model title; generated titles are not persisted).
- Respects named sessions: `/name <name>` leaves Pi in charge of the title.
- Ignores slash commands, bash lines, and extension-originated input events.
- Runs only in interactive terminal mode, not RPC, JSON, or print mode.
- Cancels outstanding title requests on session shutdown/replacement and ignores stale
  responses or queued updates from the old session.

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
