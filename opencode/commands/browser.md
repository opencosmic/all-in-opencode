---
description: Run an isolated real-browser task through the Browser agent and the upstream ego-browser runtime
agent: Browser
subtask: false
---

Handle this as a standalone browser-automation goal. Do not enter OpenSpec or the normal coding lifecycle, create or mutate implementation execution state, delegate to coding workers, use structural code tooling, or modify repository files.

Browser goal:

`$ARGUMENTS`

Load and follow the official upstream `ego-browser` skill before operating the browser. Use one ego-lite Task Space with a short, human-readable name derived from this user goal; never use an opaque or random name. Reuse that same Space across every necessary observation/action/verification round and same-goal follow-up. Prefer coherent JavaScript browser programs, verify every meaningful resulting state, and never claim success from an attempted action alone.

The user may open ego lite and select the named Space to passively observe progress; passive observation does not require a handoff. Honor Task Space ownership. For login, CAPTCHA, MFA, payment or security confirmation, another manual step, or actual user takeover, hand control to the user where appropriate, stop browser actions, explain the exact required action, and wait for explicit confirmation before taking control back. Never automatically seize a user-controlled space.

Use `ego-browser` only for the requested browser work. Its agent-authored JavaScript runs in Node.js; the allowed outer command is not an OS-level sandbox and must never be used as a generic shell, filesystem, process-execution, or repository-mutation escape.

After fresh browser evidence confirms completion, close scratch, transient, duplicate, and otherwise unhelpful tabs so only useful final-state tabs remain. Then use one dedicated final `ego-browser` heredoc to call `task.finish({ keep: ["p1"] })` (or the labels of useful final pages) and verify the finish receipt. This dismisses the agent overlay and retains the completed Space for inspection and same-goal follow-up.

Only when the user explicitly asks to close, clean up, remove, or discard the Space (or retention is impossible under the upstream contract), finish with `task.finish({ keep: [] })`, verify closure in the finish receipt, and report it. Otherwise concisely report what happened, the important results, the retained Space's human-readable name and id, how to open ego lite and select it, and any remaining user intervention.
