import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { WorkspacePackage, type TegamiPlugin } from "tegami"
import { GitTagPublishTask } from "tegami/plugins/git"
import { valid } from "semver"

export const SOLZERO_PACKAGE_ID = "release:solzero"
export const SOLZERO_VERSION_FILE = "VERSION"

class SolZeroReleasePackage extends WorkspacePackage {
  readonly manager = "release"
  readonly name = "solzero"
  readonly path: string
  #version: string

  constructor(root: string, version: string) {
    super()
    this.path = root
    this.#version = version
  }

  get version(): string {
    return this.#version
  }

  setVersion(version: string): void {
    this.#version = version
  }
}

class SolZeroGitTagPublishTask extends GitTagPublishTask<SolZeroReleasePackage> {}

async function readVersion(root: string): Promise<string> {
  const version = (await readFile(join(root, SOLZERO_VERSION_FILE), "utf8")).trim()
  if (valid(version) !== version) {
    throw new Error(`${SOLZERO_VERSION_FILE} must contain one valid SemVer version.`)
  }
  return version
}

export function solZeroRelease(): TegamiPlugin {
  let pkg: SolZeroReleasePackage | undefined

  return {
    name: "solzero-release",
    enforce: "post",
    async resolve() {
      pkg = new SolZeroReleasePackage(this.cwd, await readVersion(this.cwd))
      this.graph.add(pkg)
    },
    async applyDraft(draft) {
      if (!pkg) return
      const nextVersion = draft.getPackageDraft(pkg.id)?.bumpVersion(pkg)
      if (!nextVersion || nextVersion === pkg.version) return
      pkg.setVersion(nextVersion)
      await writeFile(join(this.cwd, SOLZERO_VERSION_FILE), `${nextVersion}\n`)
    },
    initPublishPlan({ plan }) {
      if (!pkg) return
      const packagePlan = plan.packages.get(pkg.id)
      if (!packagePlan) return
      packagePlan.git ??= {}
      packagePlan.git.tag = `v${pkg.version}`
    },
    publishPreflight({ pkg: candidate }) {
      if (candidate instanceof SolZeroReleasePackage) return { shouldPublish: true }
    },
    publishTasks({ plan }) {
      return plan
        .getPackagesToPublish()
        .flatMap((candidate) =>
          candidate instanceof SolZeroReleasePackage
            ? [new SolZeroGitTagPublishTask(candidate)]
            : [],
        )
    },
  }
}
