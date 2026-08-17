import { tegami } from "tegami"
import { runCli } from "tegami/cli"
import { github } from "tegami/plugins/github"
import { creativeRelease, formatSolZeroReleaseNotes } from "./releases/creative-release.ts"
import { solZeroRelease } from "./releases/solzero-release.ts"

const release = tegami({
  conventionalCommits: false,
  ignore: [/^npm:/],
  npm: {
    client: "nub",
    updateLockFile: false,
  },
  plugins: [
    creativeRelease(),
    github({
      repo: "SolZeroHQ/solzero",
      release: {
        eager: false,
        create({ pkg, plan }) {
          const changelogs = plan.packages.get(pkg.id)?.changelogs ?? []
          return {
            title: `SolZero v${pkg.version}`,
            notes: formatSolZeroReleaseNotes(pkg.version, changelogs),
          }
        },
      },
      versionPr: {
        base: "master",
        branch: "tegami/version-packages",
      },
    }),
    solZeroRelease(),
  ],
})

await runCli(release)
