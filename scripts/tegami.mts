import { tegami } from "tegami"
import { runCli } from "tegami/cli"
import { github } from "tegami/plugins/github"
import { solZeroRelease } from "./releases/solzero-release.ts"

const release = tegami({
  conventionalCommits: false,
  ignore: [/^npm:/],
  npm: {
    client: "nub",
    updateLockFile: false,
  },
  plugins: [
    github({
      repo: "SolZeroHQ/solzero",
      release: {
        eager: false,
        create({ pkg }) {
          return { title: `SolZero v${pkg.version}` }
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
