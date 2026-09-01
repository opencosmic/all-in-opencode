import test from "node:test"
import assert from "node:assert/strict"

import { ownedLaneExternalDirectoryPermission } from "../../scripts/probes/executor-lane-runtime.mjs"

test("runtime permits only roots and descendants of provenance-owned lane worktrees", () => {
  const lanes = { T1: "/fixture/lanes/T1", T2: "/fixture/lanes/T2" }

  assert.deepEqual(ownedLaneExternalDirectoryPermission(lanes), {
    "*": "deny",
    "/fixture/lanes/T1": "allow",
    "/fixture/lanes/T1/*": "allow",
    "/fixture/lanes/T2": "allow",
    "/fixture/lanes/T2/*": "allow",
  })
})
