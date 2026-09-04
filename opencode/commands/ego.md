---
description: Run an isolated real-browser task through Ego Browser and the upstream ego-browser runtime
agent: Ego Browser
subtask: false
---

Handle this as a standalone browser-automation goal. Do not enter OpenSpec or the normal coding lifecycle, create or mutate implementation execution state, delegate to coding workers, use structural code tooling, or modify repository files.

Browser goal:

`$ARGUMENTS`

Load and follow the official upstream `ego-browser` skill before operating the browser. Use one ego-lite Task Space for this user goal and reuse it across every necessary observation/action/verification round and same-goal follow-up. Prefer coherent JavaScript browser programs, verify every meaningful resulting state, and never claim success from an attempted action alone.

Honor Task Space ownership. For login, CAPTCHA, MFA, payment or security confirmation, or another manual step, hand control to the user, explain the exact required action, and wait for explicit confirmation before taking control back. Never automatically seize a user-controlled space.

Use `ego-browser` only for the requested browser work. Its agent-authored JavaScript runs in Node.js; the allowed outer command is not an OS-level sandbox and must never be used as a generic shell, filesystem, process-execution, or repository-mutation escape.

After fresh browser evidence confirms completion, follow the upstream completion contract and clean up the Task Space unless a concrete user-facing reason requires it to stay open. Report what happened, the important results, any intentionally open browser state, and any remaining user intervention.
