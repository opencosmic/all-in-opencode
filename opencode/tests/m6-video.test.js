import test from "node:test"
import assert from "node:assert/strict"
import { link, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import {
  editorVideoHyperFramesPathAllows,
  editorVideoHyperFramesRenderAllows,
  editorVideoProjectMutationAllows,
  prepareEditorVideoProject,
} from "../plugins/delegation/production-control.js"
import { delegationPluginHooks } from "../plugins/delegation/plugin-hooks.js"

function fakeClient() {
  const state = { creates: [], prompts: [] }
  return {
    state,
    session: {
      create: async (request) => {
        state.creates.push(request)
        return { data: { id: `video-editor-${state.creates.length}` } }
      },
      promptAsync: async (request) => {
        state.prompts.push(request)
        return { data: undefined }
      },
      abort: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aio-m6-video-")))
  const stateDirectory = join(root, ".state")
  const path = "videos/fox-card-0123456789"
  const prepared = await prepareEditorVideoProject(root, path)
  const hyperframesSkillPath = join(root, ".installed-skills", "hyperframes", "SKILL.md")
  await mkdir(join(root, ".installed-skills", "hyperframes"), { recursive: true })
  await writeFile(hyperframesSkillPath, "# HyperFrames\nOfficial router fixture.\n")
  const client = fakeClient()
  const runtime = await DelegationRuntime.create({
    client,
    directory: root,
    stateDirectory,
    skillEntries: [{ name: "hyperframes", description: "Official HyperFrames router", path: hyperframesSkillPath, content: "Use the official router." }],
    aioConfig: { version: 1 },
  })
  const producer = { agent: "Producer", sessionID: "m6-producer-primary", messageID: "video-turn", directory: root }
  const editorID = "m6-editor-child"
  runtime.profiles.set(editorID, {
    agent: "Editor",
    category: null,
    directory: root,
    video_project_path: path,
  })
  t.after(async () => {
    runtime.profiles.delete(editorID)
    runtime.videoCommands.delete(producer.sessionID)
    await rm(root, { recursive: true, force: true })
  })
  return { root, path, prepared, client, runtime, producer, editorID, stateDirectory, hyperframesSkillPath }
}

async function permission(runtime, sessionID, type, pattern) {
  const output = { status: "ask" }
  await runtime.applyPermission({ sessionID, permission: type, patterns: [pattern] }, output)
  return output.status
}

async function createVideoTask(f, hooks, brief, description = "Create a lightweight video project") {
  await hooks["command.execute.before"]({
    command: "/video",
    sessionID: f.producer.sessionID,
    arguments: brief,
  }, { parts: [] })
  await f.runtime.delegate({
    agent: "Editor",
    description,
    prompt: brief,
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, f.producer)
  return f.runtime.registry.list({ parent_session_id: f.producer.sessionID }).at(-1)
}

async function resumeVideoTask(f, task, description = "Continue the selected video project") {
  await f.runtime.delegate({
    agent: "Editor",
    description,
    prompt: "Continue the selected project using its runtime-authorized scope.",
    load_skills: ["hyperframes"],
    resume_video_task_id: task.task_id,
    run_in_background: true,
  }, f.producer)
  return f.runtime.registry.list({ parent_session_id: f.producer.sessionID }).at(-1)
}

async function finishVideoTask(runtime, task) {
  await runtime.registry.terminal(task.task_id, "completed", { result: { text: "Video task complete" } })
}

async function registerResumeTarget(f, overrides = {}, { complete = true } = {}) {
  const number = f.runtime.registry.list().length + 1
  const task = await f.runtime.registry.register({
    parent_session_id: f.producer.sessionID,
    parent_message_id: `resume-target-${number}`,
    parent_agent: "Producer",
    parent_directory: f.root,
    execution_directory: f.root,
    category: null,
    workspace_id: null,
    change_id: null,
    agent: "Editor",
    description: "Existing /video task",
    video_project_path: f.path,
    ...overrides,
  })
  await f.runtime.registry.start(task.task_id, { child_session_id: `resume-editor-${number}` })
  if (complete) await finishVideoTask(f.runtime, task)
  return f.runtime.registry.get(task.task_id)
}

test("the authenticated /video command binds the primary Producer handoff to one Editor project", async (t) => {
  const f = await fixture(t)
  const brief = "A kinetic fox title card"
  const hooks = delegationPluginHooks(f.runtime)
  await hooks["command.execute.before"]({ command: "/video", sessionID: f.producer.sessionID, arguments: brief }, { parts: [] })
  f.runtime.observeSessionAgent({ sessionID: f.producer.sessionID, agent: "Producer" })
  assert.equal(await permission(f.runtime, f.producer.sessionID, "write", "notes.txt"), "deny")
  await assert.rejects(f.runtime.applyToolExecutionBefore({ tool: "write", sessionID: f.producer.sessionID }, { args: { filePath: "notes.txt" } }), /does not author files during an active \/video task/)

  await assert.rejects(f.runtime.delegate({
    category: "video-analysis",
    description: "Wrong /video route",
    prompt: "Should not start",
    run_in_background: true,
  }, f.producer), /may delegate only its named Editor task/)

  await assert.rejects(f.runtime.delegate({
    agent: "Editor",
    description: "Missing router skill",
    prompt: "Build the composition",
    run_in_background: true,
  }, f.producer), /must load the official hyperframes router skill/)

  await f.runtime.delegate({
    agent: "Editor",
    description: "Build a lightweight HyperFrames composition",
    prompt: brief,
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, f.producer)

  const child = f.client.state.creates[0]
  const editorConfig = { agent: { Editor: { permission: { external_directory: "ask" } } } }
  await hooks.config(editorConfig)
  const externalRules = editorConfig.agent.Editor.permission.external_directory
  assert.equal(externalRules["*"], "ask")
  assert.equal(externalRules[join(f.root, ".installed-skills", "hyperframes", "references")], "allow")
  assert.equal(externalRules[`${join(f.root, ".installed-skills", "hyperframes", "references")}/*`], "allow")
  assert.equal(Object.values(externalRules).includes("allow") && externalRules["*"] === "allow", false)
  assert.equal(Object.keys(externalRules).some((pattern) => pattern.includes("outside")), false)
  const prompt = f.client.state.prompts[0].body.parts[0].text
  const task = f.runtime.registry.list({ parent_session_id: f.producer.sessionID })[0]
  assert.equal(child.query.directory, f.root)
  assert.match(prompt, /Runtime-authorized lightweight video project: videos\/a-kinetic-fox-title-card-[a-f0-9]{10}/)
  assert.equal(task.agent, "Editor")
  assert.equal(task.video_project_path, "videos/a-kinetic-fox-title-card-" + task.video_project_path.split("-").at(-1))
  assert.equal(f.runtime.profiles.get("video-editor-1").video_project_path, task.video_project_path)
  assert.equal(f.runtime.videoCommands.has(f.producer.sessionID), true)

  const differentWorkspace = await mkdtemp(join(tmpdir(), "aio-m6-video-wrong-workspace-"))
  t.after(async () => rm(differentWorkspace, { recursive: true, force: true }))
  await assert.rejects(f.runtime.delegate({
    agent: "Editor",
    description: "Cross-workspace continuation",
    prompt: "Do not reuse the original project elsewhere",
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, { ...f.producer, directory: differentWorkspace }), /bound to its original workspace/)

  const childPretendingToBeProducer = { ...f.producer, sessionID: "video-editor-1" }
  await f.runtime.observeCommandExecution({ command: "/video", sessionID: childPretendingToBeProducer.sessionID, arguments: brief })
  await assert.rejects(f.runtime.delegate({
    agent: "Editor",
    description: "Child attempts primary route",
    prompt: "Should not start",
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, childPretendingToBeProducer), /may only be called by the primary Producer/)
  f.runtime.videoCommands.delete(childPretendingToBeProducer.sessionID)

  await f.runtime.handleEvent({ type: "session.idle", properties: { sessionID: f.producer.sessionID } })
  assert.equal(f.runtime.videoCommands.has(f.producer.sessionID), true)

  await f.runtime.registry.terminal(task.task_id, "completed", { result: { text: "Preview ready" } })

  const otherProducer = { ...f.producer, sessionID: "m6-other-producer", messageID: "other-video-turn" }
  await f.runtime.delegate({
    agent: "Editor",
    description: "Independent Editor session",
    prompt: "Build an unrelated project",
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, otherProducer)
  const otherTask = f.runtime.registry.list({ parent_session_id: otherProducer.sessionID })[0]
  assert.equal(otherTask.video_project_path, null)
  assert.notEqual(otherTask.video_project_path, task.video_project_path)
  assert.equal(await permission(f.runtime, otherTask.child_session_id, "write", `${task.video_project_path}/index.html`), "deny")
  await assert.rejects(f.runtime.applyToolExecutionBefore(
    { tool: "write", sessionID: otherTask.child_session_id },
    { args: { filePath: `${task.video_project_path}/index.html` } },
  ), /safe files under production\/composition/)

  await f.runtime.delegate({
    agent: "Editor",
    description: "Render the reviewed composition",
    prompt: "Producer confirms that the user approved the preview. Render the local final MP4.",
    load_skills: ["hyperframes"],
    resume_video_task_id: task.task_id,
    run_in_background: true,
  }, f.producer)
  const resumedTask = f.runtime.registry.list({ parent_session_id: f.producer.sessionID })[1]
  assert.equal(resumedTask.video_project_path, task.video_project_path)
  assert.equal(f.runtime.profiles.get(resumedTask.child_session_id).video_project_path, task.video_project_path)
  await f.runtime.registry.terminal(resumedTask.task_id, "completed", { result: { text: "Render complete" } })

  await hooks["command.execute.before"]({ command: "/video", sessionID: f.producer.sessionID, arguments: brief }, { parts: [] })
  await f.runtime.delegate({
    agent: "Editor",
    description: "A new video request with the same brief",
    prompt: brief,
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, f.producer)
  const newVideoTask = f.runtime.registry.list({ parent_session_id: f.producer.sessionID })[2]
  assert.notEqual(newVideoTask.video_project_path, task.video_project_path)
  await f.runtime.registry.terminal(newVideoTask.task_id, "completed", { result: { text: "Second preview ready" } })

  f.runtime.videoCommands.get(f.producer.sessionID).expires_at = Date.now() - 1
  await f.runtime.delegate({
    agent: "Editor",
    description: "Resume after delayed approval",
    prompt: "The user approved the existing preview. Render the original project locally.",
    load_skills: ["hyperframes"],
    resume_video_task_id: task.task_id,
    run_in_background: true,
  }, f.producer)
  const delayedResumeTask = f.runtime.registry.list({ parent_session_id: f.producer.sessionID })[3]
  assert.equal(delayedResumeTask.video_project_path, task.video_project_path)
  assert.equal(f.runtime.profiles.get(delayedResumeTask.child_session_id).video_project_path, task.video_project_path)

  f.runtime.videoCommands.get(f.producer.sessionID).expires_at = Date.now() - 1
  await f.runtime.delegate({
    agent: "Editor",
    description: "Unscoped Editor request after expiration",
    prompt: "This has no video command or explicit resume identity.",
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, f.producer)
  const unscopedTask = f.runtime.registry.list({ parent_session_id: f.producer.sessionID })[4]
  assert.equal(unscopedTask.video_project_path, null)

  const spoofed = { ...f.producer, sessionID: "m6-producer-without-command" }
  await assert.rejects(f.runtime.delegate({
    agent: "Editor",
    video_project_path: "videos/arbitrary-0123456789",
    description: "Spoofed route",
    prompt: "Do not start",
    load_skills: ["hyperframes"],
    run_in_background: true,
  }, spoofed), /assigned only by an authenticated \/video command or validated task resume/)
})

test("multi-project resume always restores the explicitly selected Editor task", async (t) => {
  const f = await fixture(t)
  const hooks = delegationPluginHooks(f.runtime)
  const taskA = await createVideoTask(f, hooks, "Project A: kinetic fox")
  await finishVideoTask(f.runtime, taskA)

  const firstResumeA = await resumeVideoTask(f, taskA, "Resume Project A")
  assert.equal(firstResumeA.video_project_path, taskA.video_project_path)
  assert.equal(f.runtime.profiles.get(firstResumeA.child_session_id).video_project_path, taskA.video_project_path)
  await finishVideoTask(f.runtime, firstResumeA)

  const taskB = await createVideoTask(f, hooks, "Project B: blue scarf")
  assert.notEqual(taskB.video_project_path, taskA.video_project_path)
  await finishVideoTask(f.runtime, taskB)

  const secondResumeA = await resumeVideoTask(f, taskA, "Resume older Project A")
  assert.equal(secondResumeA.video_project_path, taskA.video_project_path)
  assert.equal(f.runtime.profiles.get(secondResumeA.child_session_id).video_project_path, taskA.video_project_path)
  await finishVideoTask(f.runtime, secondResumeA)

  const resumeB = await resumeVideoTask(f, taskB, "Resume Project B")
  assert.equal(resumeB.video_project_path, taskB.video_project_path)
  assert.equal(f.runtime.profiles.get(resumeB.child_session_id).video_project_path, taskB.video_project_path)
})

test("video resume identity is restored from the persisted TaskRegistry after runtime recreation", async (t) => {
  const f = await fixture(t)
  const hooks = delegationPluginHooks(f.runtime)
  const task = await createVideoTask(f, hooks, "Persistent lightweight video")
  await finishVideoTask(f.runtime, task)
  f.runtime.videoCommands.delete(f.producer.sessionID)

  const restarted = await DelegationRuntime.create({
    client: f.client,
    directory: f.root,
    stateDirectory: f.stateDirectory,
    skillEntries: [{
      name: "hyperframes",
      description: "Official HyperFrames router",
      path: f.hyperframesSkillPath,
      content: "Use the official router.",
    }],
    aioConfig: { version: 1 },
  })
  await restarted.delegate({
    agent: "Editor",
    description: "Resume the persisted video task",
    prompt: "Continue the existing project.",
    load_skills: ["hyperframes"],
    resume_video_task_id: task.task_id,
    run_in_background: true,
  }, f.producer)

  const resumed = restarted.registry.list({ parent_session_id: f.producer.sessionID }).at(-1)
  assert.equal(resumed.video_project_path, task.video_project_path)
  assert.equal(restarted.profiles.get(resumed.child_session_id).video_project_path, task.video_project_path)
})

test("video task resume is isolated to its Producer session and rejects invalid identities", async (t) => {
  const f = await fixture(t)
  const hooks = delegationPluginHooks(f.runtime)
  const validTask = await createVideoTask(f, hooks, "Owned video project")
  await finishVideoTask(f.runtime, validTask)

  const otherProducer = { ...f.producer, sessionID: "m6-video-foreign-producer", messageID: "foreign-resume" }
  await assert.rejects(f.runtime.delegate({
    agent: "Editor",
    description: "Cross-session resume",
    prompt: "Do not start",
    load_skills: ["hyperframes"],
    resume_video_task_id: validTask.task_id,
    run_in_background: true,
  }, otherProducer), /not a terminal \/video Editor task owned by this Producer session/)
  assert.equal(f.client.state.creates.length, 1)

  await assert.rejects(f.runtime.delegate({
    agent: "Editor",
    description: "Unknown resume target",
    prompt: "Do not start",
    load_skills: ["hyperframes"],
    resume_video_task_id: "task_unknown-video-project",
    run_in_background: true,
  }, f.producer), /unknown task_id/)

  const noVideo = await registerResumeTarget(f, { video_project_path: null })
  await assert.rejects(resumeVideoTask(f, noVideo), /not a terminal \/video Editor task/)

  const wrongAgent = await registerResumeTarget(f, { agent: "Creator" })
  await assert.rejects(resumeVideoTask(f, wrongAgent), /not a terminal \/video Editor task/)

  const missingParentAgent = await registerResumeTarget(f, { parent_agent: null })
  await assert.rejects(resumeVideoTask(f, missingParentAgent), /not a terminal \/video Editor task/)

  const runningTask = await registerResumeTarget(f, {}, { complete: false })
  await assert.rejects(resumeVideoTask(f, runningTask), /not a terminal \/video Editor task/)

  const wrongWorkspace = await realpath(await mkdtemp(join(tmpdir(), "aio-m6-video-resume-workspace-")))
  t.after(async () => rm(wrongWorkspace, { recursive: true, force: true }))
  const otherPath = "videos/other-workspace-0123456789"
  await prepareEditorVideoProject(wrongWorkspace, otherPath)
  const otherWorkspaceTask = await registerResumeTarget(f, {
    parent_directory: wrongWorkspace,
    execution_directory: wrongWorkspace,
    video_project_path: otherPath,
  })
  await assert.rejects(resumeVideoTask(f, otherWorkspaceTask), /belongs to a different workspace/)

  const invalidPathTask = await registerResumeTarget(f, { video_project_path: "videos/not-runtime-issued" })
  await assert.rejects(resumeVideoTask(f, invalidPathTask), /runtime-issued videos/)

  const disappearedPath = "videos/disappeared-project-abcdef0123"
  const disappeared = await prepareEditorVideoProject(f.root, disappearedPath)
  const disappearedTask = await registerResumeTarget(f, { video_project_path: disappearedPath })
  await rm(disappeared.project_root, { recursive: true, force: true })
  await assert.rejects(resumeVideoTask(f, disappearedTask), /project is missing/)
  assert.equal(f.client.state.creates.length, 1)
})

test("Editor writes and HyperFrames operations stay inside its runtime-issued lightweight project", async (t) => {
  const f = await fixture(t)
  const file = `${f.path}/index.html`
  const sibling = "videos/other-project-0123456789/index.html"
  const external = join(f.root, "outside.html")
  await writeFile(external, "outside")

  assert.equal(await permission(f.runtime, f.editorID, "write", file), "allow")
  assert.equal(await editorVideoProjectMutationAllows(join(f.root, file), f.root, f.path), true)
  assert.equal(await permission(f.runtime, f.editorID, "write", sibling), "deny")
  assert.equal(await permission(f.runtime, f.editorID, "write", "production/production-manifest.json"), "deny")
  assert.equal(await permission(f.runtime, f.editorID, "write", `${f.path}/.env.local`), "deny")
  assert.equal(await permission(f.runtime, f.editorID, "write", `${f.path}/.git/config`), "deny")
  assert.equal(await permission(f.runtime, f.editorID, "write", `${f.path}/../outside.html`), "deny")
  assert.equal(await permission(f.runtime, f.editorID, "external_directory", join(f.root, ".installed-skills", "hyperframes")), "allow")
  assert.equal(await permission(f.runtime, f.editorID, "external_directory", join(f.root, "outside.html")), "deny")

  f.runtime.observeSessionAgent({ sessionID: f.producer.sessionID, agent: "Producer" })
  assert.equal(await permission(f.runtime, f.producer.sessionID, "edit", file), "deny")
  await assert.rejects(f.runtime.applyToolExecutionBefore({ tool: "write", sessionID: f.producer.sessionID }, { args: { filePath: file } }), /delegates lightweight video project authoring/)
  await assert.rejects(f.runtime.applyToolExecutionBefore({ tool: "bash", sessionID: f.producer.sessionID }, { args: { command: `npx hyperframes check ${f.path}` } }), /delegates HyperFrames commands/)

  const command = async (value) => permission(f.runtime, f.editorID, "bash", value)
  assert.equal(await command(`npx hyperframes check ${f.path}`), "allow")
  assert.equal(await command(`npx hyperframes snapshot ${f.path}`), "allow")
  assert.equal(await command(`npx hyperframes preview ${f.path}`), "allow")
  assert.equal(await command(`npx hyperframes add title --dir ${f.path}`), "allow")
  assert.equal(await command(`npx hyperframes init ${f.path}`), "deny")
  assert.equal(await command(`HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init ${f.path} --non-interactive --example=blank`), "ask")
  assert.equal(await command("npx hyperframes skills check --json"), "allow")
  assert.equal(await command("npx hyperframes skills check"), "deny")
  assert.equal(await command(`npx hyperframes skills update motion-graphics`), "ask")
  assert.equal(await command(`npx hyperframes render ${f.path} --output ${f.path}/final.mp4 --quality delivery --fps 8 --workers 1`), "ask")
  assert.equal(await editorVideoHyperFramesRenderAllows(`npx hyperframes render ${f.path} --output ${f.path}/final.mp4 --quality delivery --fps 8 --workers 1`, f.root, f.path), true)
  assert.equal(await command(`npx hyperframes render ${f.path} --output videos/outside.mp4 --fps 8 --workers 1`), "deny")
  assert.equal(await command(`npx hyperframes render ${f.path} --output ${f.path}/final.mp4 --fps 120 --workers 1`), "deny")
  assert.equal(await command(`npx hyperframes cloud ${f.path}`), "deny")
  assert.equal(await command(`npx hyperframes publish ${f.path}`), "deny")
  assert.equal(await command(`npx hyperframes check ${f.path} && echo unsafe`), "deny")

  await assert.rejects(f.runtime.applyToolExecutionBefore({ tool: "write", sessionID: f.editorID }, { args: { filePath: sibling } }), /runtime-authorized lightweight video project/)
  await f.runtime.applyToolExecutionBefore({ tool: "write", sessionID: f.editorID }, { args: { filePath: file } })
  await f.runtime.applyToolExecutionBefore({ tool: "bash", sessionID: f.editorID }, { args: { command: `npx hyperframes check ${f.path}` } })
  await f.runtime.applyToolExecutionBefore({ tool: "bash", sessionID: f.editorID }, { args: { command: `npx hyperframes render ${f.path} --output ${f.path}/final.mp4 --fps 8 --workers 1` } })
  await assert.rejects(f.runtime.applyToolExecutionBefore({ tool: "bash", sessionID: f.editorID }, { args: { command: `npx hyperframes render ${f.path} --output ${external} --fps 8 --workers 1` } }), /safe local HyperFrames command/)

  await mkdir(join(f.prepared.project_root, "unsafe"))
  await symlink(external, join(f.prepared.project_root, "unsafe", "link.html"))
  assert.equal(await editorVideoProjectMutationAllows(file, f.root, f.path), false)
  await rm(join(f.prepared.project_root, "unsafe"), { recursive: true })
  await link(external, join(f.prepared.project_root, "aliased.html"))
  assert.equal(await editorVideoProjectMutationAllows(file, f.root, f.path), false)
})

test("Editor asset imports reject escaped sources and destinations through runtime Bash authorization", async (t) => {
  const f = await fixture(t)
  const localSource = join(f.root, "local-video.mp4")
  await writeFile(localSource, "local media")
  await mkdir(join(f.prepared.project_root, "assets"), { recursive: true })
  const copy = (source, destination = `${f.path}/assets/copied.mp4`) => `cp -- ${source} ${destination}`
  const permissionFor = (command) => permission(f.runtime, f.editorID, "bash", command)
  const execute = (command) => f.runtime.applyToolExecutionBefore(
    { tool: "bash", sessionID: f.editorID },
    { args: { command } },
  )

  assert.equal(await permissionFor(copy("local-video.mp4")), "allow")
  await execute(copy("local-video.mp4"))

  const outside = await realpath(await mkdtemp(join(tmpdir(), "aio-m6-video-source-outside-")))
  t.after(async () => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, "private-video.mp4"), "private media")
  await symlink(outside, join(f.root, "external-media"))
  const escapedParent = copy("external-media/private-video.mp4")
  assert.equal(await permissionFor(escapedParent), "deny")
  await assert.rejects(execute(escapedParent), /safe local HyperFrames command/)

  await symlink(localSource, join(f.root, "linked-video.mp4"))
  const linkedFile = copy("linked-video.mp4")
  assert.equal(await permissionFor(linkedFile), "deny")
  await assert.rejects(execute(linkedFile), /safe local HyperFrames command/)

  await link(localSource, join(f.root, "hardlinked-video.mp4"))
  const hardlink = copy("hardlinked-video.mp4")
  assert.equal(await permissionFor(hardlink), "deny")
  await assert.rejects(execute(hardlink), /safe local HyperFrames command/)

  const absoluteSource = copy(join(outside, "private-video.mp4"))
  assert.equal(await permissionFor(absoluteSource), "deny")
  const traversalDestination = copy("local-video.mp4", `${f.path}/assets/../outside.mp4`)
  assert.equal(await permissionFor(traversalDestination), "deny")

  await symlink(outside, join(f.prepared.project_root, "assets", "external"))
  const linkedDestination = copy("local-video.mp4", `${f.path}/assets/external/copied.mp4`)
  assert.equal(await permissionFor(linkedDestination), "deny")
  await assert.rejects(execute(linkedDestination), /safe local HyperFrames command/)
})

test("the video project root is runtime-created and refuses linked roots", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aio-m6-video-symlink-root-"))
  const outside = await mkdtemp(join(tmpdir(), "aio-m6-video-outside-"))
  t.after(async () => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]))
  await symlink(outside, join(root, "videos"))
  await assert.rejects(prepareEditorVideoProject(root, "videos/demo-0123456789"), /must be a real directory/)
  assert.equal(await editorVideoHyperFramesPathAllows("videos/demo-0123456789", root, "videos/demo-0123456789"), false)
})

test("/video revision inspection passes both hooks only for the authenticated safe project", async (t) => {
  const f = await fixture(t)
  const hooks = delegationPluginHooks(f.runtime)
  const allowed = [
    `npx hyperframes timeline ${f.path} --json`,
    `HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes timeline ${f.path} --json`,
    `npx hyperframes history --dir ${f.path} --since mine --who editor --json`,
    `npx hyperframes history --dir=${f.path} --json --who Editor --since=mine`,
  ]
  for (const command of allowed) {
    const output = { status: "ask" }
    await hooks["permission.ask"]({ sessionID: f.editorID, permission: "bash", patterns: [command] }, output)
    assert.equal(output.status, "allow", command)
    await hooks["tool.execute.before"]({ sessionID: f.editorID, tool: "bash" }, { args: { command } })
  }
  // Inspection grants no native render approval; the existing /video gate stays ASK.
  assert.equal(await permission(f.runtime, f.editorID, "bash", `npx hyperframes render ${f.path} --output ${f.path}/final.mp4 --fps 24 --workers 1`), "ask")
  const denied = [
    `npx hyperframes timeline videos/other-project-0123456789 --json`,
    `npx hyperframes timeline ${f.path}/../outside --json`,
    `npx hyperframes timeline ${join(f.root, f.path)} --json`,
    `npx hyperframes timeline ${f.path} --json && touch marker`,
    `npx hyperframes timeline ${f.path} --json | cat`,
    `npx hyperframes timeline ${f.path} --json > result.json`,
    `npx hyperframes timeline ${f.path} --json $(touch marker)`,
    `npx hyperframes timeline ${f.path} move clip --start 1`,
    `npx hyperframes timeline ${f.path} --json --component clip`,
    `npx hyperframes history ${f.path} --since mine --who editor`,
    `npx hyperframes history --dir ${f.path} --dir videos/other-project-0123456789 --json`,
    `npx hyperframes history --dir videos/other-project-0123456789 --json`,
    ...["undo", "restore", "rollback", "begin", "end", "pin"].map((verb) => `npx hyperframes history ${verb} --dir ${f.path}`),
  ]
  for (const command of denied) {
    assert.equal(await permission(f.runtime, f.editorID, "bash", command), "deny", command)
    await assert.rejects(hooks["tool.execute.before"]({ sessionID: f.editorID, tool: "bash" }, { args: { command } }))
  }
  for (const profile of [
    { agent: "Editor", directory: f.root, film_composition_context: true },
    { agent: "Editor", directory: f.root },
    { agent: "Editor", directory: f.root, video_project_path: "videos/invalid" },
    { agent: "Editor", directory: f.root, video_project_path: "videos/missing-0123456789" },
  ]) {
    f.runtime.profiles.set("inspection-other", profile)
    for (const command of allowed.slice(0, 1)) {
      assert.equal(await permission(f.runtime, "inspection-other", "bash", command), "deny")
      await assert.rejects(hooks["tool.execute.before"]({ sessionID: "inspection-other", tool: "bash" }, { args: { command } }))
    }
  }
  for (const invalidPath of ["videos/invalid", "videos/missing-0123456789"]) {
    f.runtime.profiles.set("inspection-other", { agent: "Editor", directory: f.root, video_project_path: invalidPath })
    const command = `npx hyperframes timeline ${invalidPath} --json`
    assert.equal(await permission(f.runtime, "inspection-other", "bash", command), "deny")
    await assert.rejects(hooks["tool.execute.before"]({ sessionID: "inspection-other", tool: "bash" }, { args: { command } }))
  }
  f.runtime.profiles.delete("inspection-other")
  const moved = join(f.root, "moved-project")
  await rename(f.prepared.project_root, moved)
  assert.equal(await permission(f.runtime, f.editorID, "bash", allowed[0]), "deny")
  await symlink(moved, f.prepared.project_root)
  assert.equal(await permission(f.runtime, f.editorID, "bash", allowed[0]), "deny")
  await assert.rejects(hooks["tool.execute.before"]({ sessionID: f.editorID, tool: "bash" }, { args: { command: allowed[0] } }))
  await rm(f.prepared.project_root)
  await rename(moved, f.prepared.project_root)
  // The root is revalidated by both hooks; changing the tree after permission is not a bypass.
  const command = allowed[0]
  const outside = join(f.root, "outside.txt")
  await writeFile(outside, "outside")
  await symlink(outside, join(f.prepared.project_root, "escape.txt"))
  assert.equal(await permission(f.runtime, f.editorID, "bash", command), "deny")
  await assert.rejects(hooks["tool.execute.before"]({ sessionID: f.editorID, tool: "bash" }, { args: { command } }))
  await rm(join(f.prepared.project_root, "escape.txt"))
  await link(outside, join(f.prepared.project_root, "alias.txt"))
  assert.equal(await permission(f.runtime, f.editorID, "bash", command), "deny")
  await assert.rejects(hooks["tool.execute.before"]({ sessionID: f.editorID, tool: "bash" }, { args: { command } }))
})

test("Editor command denials distinguish unsafe syntax, arguments, scope and unsupported commands", async (t) => {
  const f = await fixture(t)
  const hooks = delegationPluginHooks(f.runtime)
  for (const [command, reason] of [
    [`npx hyperframes timeline ${f.path} --json && touch marker`, "DENIED_UNSAFE_SHELL_SYNTAX"],
    [`npx hyperframes timeline ${f.path} --bad`, "DENIED_INVALID_HYPERFRAMES_ARGUMENTS"],
    ["npx hyperframes timeline videos/other-project-0123456789 --json", "DENIED_VIDEO_PROJECT_SCOPE"],
    [`npx hyperframes history undo --dir ${f.path}`, "DENIED_INVALID_HYPERFRAMES_ARGUMENTS"],
    [`npx hyperframes publish ${f.path}`, "DENIED_UNSUPPORTED_HYPERFRAMES_COMMAND"],
  ]) {
    await assert.rejects(hooks["tool.execute.before"]({ sessionID: f.editorID, tool: "bash" }, { args: { command } }), (error) => {
      assert.match(error.message, new RegExp(reason))
      assert.doesNotMatch(error.message, /final rendering requires|\/Users\//)
      return true
    })
  }
})


test("Producer and Editor receive the verified installed setup location without new execution authority", async (t) => {
  const f = await fixture(t)
  for (const [id, agent] of [[f.producer.sessionID, "Producer"], [f.editorID, "Editor"]]) {
    f.runtime.observeSessionAgent({ sessionID: id, agent })
    const output = { system: ["Existing instructions"] }
    f.runtime.applyChatSystem(id, output)
    const text = output.system.join("\n")
    assert.match(text, /installed AIO setup script is .*scripts\/setup-hyperframes.sh/)
    assert.match(text, /Shared\/global skill installation or refresh requires explicit user approval/)
    assert.match(text, /location grants no execution permission/)
    assert.equal(await permission(f.runtime, id, "bash", "sh scripts/setup-hyperframes.sh"), "deny")
  }
})
