import { tegami } from "tegami"
import { runCli } from "tegami/cli"
import { github } from "tegami/plugins/github"
import { creativeRelease } from "./releases/creative-release.ts"
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
          const imageUrl = `https://raw.githubusercontent.com/SolZeroHQ/solzero/v${pkg.version}/docs/solzero-release-notes.png`
          const sections = (plan.packages.get(pkg.id)?.changelogs ?? []).flatMap((entry) =>
            entry.sections.flatMap((section) => [`### ${section.title}`, "", section.content, ""]),
          )
          return {
            title: `SolZero v${pkg.version}`,
            notes: [`![SolZero v${pkg.version} release notes](${imageUrl})`, "", ...sections]
              .join("\n")
              .trim(),
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
