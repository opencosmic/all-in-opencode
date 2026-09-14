const PATH_SEPARATOR = /[\\/]+/

function cleanPath(value) {
  const text = String(value ?? "").trim().replaceAll("\\", "/")
  if (!text) return ""
  return text.replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "") || "."
}

function pathTouches(left, right) {
  const a = cleanPath(left)
  const b = cleanPath(right)
  if (!a || !b) return false
  if (a === "*" || b === "*") return true
  const aParts = a.split(PATH_SEPARATOR)
  const bParts = b.split(PATH_SEPARATOR)
  const length = Math.min(aParts.length, bParts.length)
  for (let index = 0; index < length; index += 1) {
    const aPart = aParts[index]
    const bPart = bParts[index]
    if (aPart === "**" || bPart === "**") return true
    if (aPart === "*" || bPart === "*") return true
    if (aPart !== bPart) return false
  }
  return true
}

export function scopesOverlap(left = [], right = []) {
  const a = Array.isArray(left) ? left.map(cleanPath).filter(Boolean) : []
  const b = Array.isArray(right) ? right.map(cleanPath).filter(Boolean) : []
  if (!a.length || !b.length) return null
  return a.some((leftPath) => b.some((rightPath) => pathTouches(leftPath, rightPath)))
}

function asStrings(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
}

function taskValue(task, ...keys) {
  for (const key of keys) {
    if (task && Object.hasOwn(task, key) && task[key] !== undefined && task[key] !== null) return task[key]
  }
  return undefined
}

export function normalizeExecutionTasks(tasks = []) {
  if (tasks === undefined || tasks === null) return []
  if (!Array.isArray(tasks)) throw new Error("execution preflight tasks must be an array")
  return tasks.map((raw, index) => {
    const task = typeof raw === "string" ? { description: raw } : raw
    if (!task || typeof task !== "object") {
      throw new Error(`execution preflight task ${index + 1} must be a string or object`)
    }
    const description = String(taskValue(task, "description", "title", "name") ?? `Task ${index + 1}`).trim()
    if (!description) throw new Error(`execution preflight task ${index + 1} requires a description`)
    const taskID = String(taskValue(task, "task_id", "id") ?? `task-${index + 1}`).trim()
    if (!taskID) throw new Error(`execution preflight task ${index + 1} requires a task_id`)
    const writeScope = asStrings(taskValue(task, "write_scope", "writeScope", "paths", "files", "scope"))
    const dependencies = asStrings(taskValue(task, "dependencies", "depends_on", "dependsOn"))
    const acceptanceCriteria = asStrings(taskValue(task, "acceptance_criteria", "acceptanceCriteria"))
    const requiresUncommitted = taskValue(task, "requires_uncommitted", "requiresUncommitted") === true
    const dependsOnUncommitted = taskValue(task, "depends_on_uncommitted", "dependsOnUncommitted") === true
    const independentFromUncommitted = taskValue(task, "independent_from_uncommitted", "independentFromUncommitted") === true
    return {
      task_id: taskID,
      description,
      write_scope: writeScope,
      dependencies,
      acceptance_criteria: acceptanceCriteria,
      requires_uncommitted: requiresUncommitted,
      depends_on_uncommitted: dependsOnUncommitted,
      independent_from_uncommitted: independentFromUncommitted,
    }
  })
}

function dependencyMap(tasks) {
  const ids = new Set(tasks.map((task) => task.task_id))
  return new Map(tasks.map((task) => [
    task.task_id,
    task.dependencies.filter((dependency) => ids.has(dependency)),
  ]))
}

function hasDependencyPath(start, target, dependencies, seen = new Set()) {
  if (start === target) return true
  if (seen.has(start)) return false
  seen.add(start)
  return (dependencies.get(start) ?? []).some((dependency) => hasDependencyPath(dependency, target, dependencies, seen))
}

export function analyzeExecutionTasks(input = []) {
  const tasks = normalizeExecutionTasks(input)
  const seenTaskIDs = new Set()
  for (const task of tasks) {
    if (seenTaskIDs.has(task.task_id)) throw new Error(`execution preflight task_id is duplicated: ${task.task_id}`)
    seenTaskIDs.add(task.task_id)
  }
  const dependencies = dependencyMap(tasks)
  const overlapPairs = []
  const unknownScopeTasks = tasks.filter((task) => !task.write_scope.length).map((task) => task.task_id)
  const uncommittedTasks = tasks
    .filter((task) => (task.requires_uncommitted || task.depends_on_uncommitted) && !task.independent_from_uncommitted)
    .map((task) => task.task_id)
  const unknownDependencies = tasks.flatMap((task) => task.dependencies
    .filter((dependency) => !dependencies.has(dependency))
    .map((dependency) => ({ from: dependency, to: task.task_id })))

  for (let left = 0; left < tasks.length; left += 1) {
    for (let right = left + 1; right < tasks.length; right += 1) {
      const overlap = scopesOverlap(tasks[left].write_scope, tasks[right].write_scope)
      if (overlap === true) overlapPairs.push([tasks[left].task_id, tasks[right].task_id])
    }
  }

  const hasDependencies = [...dependencies.values()].some((items) => items.length > 0)
  const hasUnknownScope = unknownScopeTasks.length > 0
  const canParallelize = tasks.length > 1
    && !hasDependencies
    && !hasUnknownScope
    && !unknownDependencies.length
    && !uncommittedTasks.length
    && overlapPairs.length === 0
  const mustSerialize = tasks.length > 1 && !canParallelize
  const executionMode = tasks.length < 2
    ? "single"
    : canParallelize
      ? "parallel-candidates"
      : "serialize"

  const details = tasks.map((task) => {
    const overlaps = overlapPairs
      .filter(([left, right]) => left === task.task_id || right === task.task_id)
      .map(([left, right]) => left === task.task_id ? right : left)
    const dependencyReasons = task.dependencies.filter((dependency) => dependencies.has(dependency))
    const missingDependencies = task.dependencies.filter((dependency) => !dependencies.has(dependency))
    const reasons = []
    if (dependencyReasons.length) reasons.push("dependency edge")
    if (missingDependencies.length) reasons.push("unknown dependency")
    if (overlaps.length) reasons.push("overlapping write scope")
    if (!task.write_scope.length) reasons.push("write scope is unknown")
    if (uncommittedTasks.includes(task.task_id)) reasons.push("required uncommitted state")
    return {
      ...task,
      overlaps,
      missing_dependencies: missingDependencies,
      execution_mode: canParallelize ? "parallel-candidate" : "must-serialize",
      serialization_reasons: reasons,
    }
  })

  const cycles = []
  for (const task of tasks) {
    for (const dependency of dependencies.get(task.task_id) ?? []) {
      if (hasDependencyPath(dependency, task.task_id, dependencies)) cycles.push([task.task_id, dependency])
    }
  }

  return {
    tasks: details,
    dependency_edges: details.flatMap((task) => task.dependencies
      .filter((dependency) => dependencies.has(dependency))
      .map((dependency) => ({ from: dependency, to: task.task_id }))),
    unknown_dependencies: unknownDependencies,
    overlap_pairs: overlapPairs,
    unknown_scope_tasks: unknownScopeTasks,
    uncommitted_tasks: uncommittedTasks,
    cycles,
    execution_mode: executionMode,
    parallel_safe: canParallelize,
    must_serialize: mustSerialize,
  }
}

export function summarizeTask(task) {
  return {
    task_id: task.task_id,
    change_id: task.change_id ?? null,
    status: task.status,
    workspace_id: task.workspace_id ?? null,
    execution_directory: task.execution_directory ?? null,
    agent: task.agent ?? null,
    category: task.category ?? null,
    description: task.description ?? null,
    started_at: task.started_at ?? null,
    completed_at: task.completed_at ?? null,
    error: task.error ?? null,
  }
}
