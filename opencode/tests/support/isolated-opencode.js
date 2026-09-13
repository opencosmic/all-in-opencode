import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export async function isolatedOpenCodeEnv(testContext, repository) {
  // These checks exercise the installed CLI against aio-owned configuration,
  // not the user's persistent OpenCode database. A private root also keeps
  // concurrent CLI startups from racing on one migration history.
  const root = await mkdtemp(join(tmpdir(), "aio-opencode-test-"))
  const home = join(root, "home")
  const paths = {
    home,
    config: join(home, ".config"),
    data: join(home, ".local", "share"),
    state: join(home, ".local", "state"),
    cache: join(home, ".cache"),
  }
  const configDirectory = join(paths.config, "opencode")
  await Promise.all([...Object.values(paths), configDirectory].map((path) => mkdir(path, { recursive: true })))
  await Promise.all([
    ["agents", "agents"],
    ["commands", "commands"],
    ["plugins", "plugins"],
    ["skills", "skills"],
    ["node_modules", "node_modules"],
  ].map(([source, target]) => symlink(join(repository, "opencode", source), join(configDirectory, target), "dir")))
  await Promise.all(["package.json", "package-lock.json"].map((name) => symlink(
    join(repository, "opencode", name),
    join(configDirectory, name),
    "file",
  )))
  testContext.after(() => rm(root, { recursive: true, force: true }))

  const env = { ...process.env }
  for (const key of ["OPENCODE_CONFIG", "OPENCODE_PURE"]) delete env[key]
  return {
    ...env,
    HOME: paths.home,
    OPENCODE_TEST_HOME: paths.home,
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_STATE_HOME: paths.state,
    XDG_CACHE_HOME: paths.cache,
    OPENCODE_CONFIG_DIR: configDirectory,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_AUTH_CONTENT: "{}",
  }
}
