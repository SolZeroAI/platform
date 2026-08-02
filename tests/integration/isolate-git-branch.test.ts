import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { describe, expect, it, vi } from "vitest"
import {
  checkoutIsolateBranch,
  getCloneBaseBranch,
  hasBranchCommitsBeyondBase,
} from "../../packages/api/src/server/background/isolate/git-branch"

describe("isolate git branch checkout", () => {
  it("creates a new c0 branch from the current HEAD without looking for origin branch", async () => {
    const git = {
      branch: vi.fn().mockResolvedValue({
        branches: ["main"],
        current: "main",
      }),
      checkout: vi.fn(),
      log: vi.fn().mockResolvedValue([
        {
          oid: "abc123",
          message: "Initial commit",
          author: { name: "A", email: "a@example.com", timestamp: 1 },
          parent: [],
        },
      ]),
    }
    const workspace = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    }

    await Effect.runPromise(
      checkoutIsolateBranch({
        workspace,
        git,
        repoRoot: "/repo",
        branchName: "c0-agent/session-1",
      }),
    )

    expect(git.checkout).not.toHaveBeenCalled()
    expect(workspace.mkdir).toHaveBeenCalledWith("/repo/.git/refs/heads/c0-agent", {
      recursive: true,
    })
    expect(workspace.writeFile).toHaveBeenCalledWith(
      "/repo/.git/refs/heads/c0-agent/session-1",
      "abc123\n",
    )
    expect(workspace.writeFile).toHaveBeenCalledWith(
      "/repo/.git/HEAD",
      "ref: refs/heads/c0-agent/session-1\n",
    )
  })

  it("checks out an existing local c0 branch by ref", async () => {
    const git = {
      branch: vi.fn().mockResolvedValue({
        branches: ["main", "c0-agent/session-1"],
        current: "main",
      }),
      checkout: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
    }
    const workspace = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    }

    await Effect.runPromise(
      checkoutIsolateBranch({
        workspace,
        git,
        repoRoot: "/repo",
        branchName: "c0-agent/session-1",
      }),
    )

    expect(git.checkout).toHaveBeenCalledWith({
      ref: "c0-agent/session-1",
      dir: "/repo",
    })
    expect(git.log).not.toHaveBeenCalled()
    expect(workspace.writeFile).not.toHaveBeenCalled()
  })
})

describe("isolate clone base branch", () => {
  it("does not use the managed c0 branch as the clone base", () => {
    expect(
      Option.getOrUndefined(
        getCloneBaseBranch({
          repoDefaultBranch: "c0-agent/session-1",
          branchName: "c0-agent/session-1",
        }),
      ),
    ).toBeUndefined()
  })

  it("uses the repository default branch when it differs from the c0 branch", () => {
    expect(
      Option.getOrUndefined(
        getCloneBaseBranch({
          repoDefaultBranch: "main",
          branchName: "c0-agent/session-1",
        }),
      ),
    ).toBe("main")
  })
})

describe("isolate branch PR retry detection", () => {
  it("treats a clean branch with a distinct head as ready for PR creation", async () => {
    const git = {
      log: vi
        .fn()
        .mockResolvedValueOnce([
          {
            oid: "feature-commit",
            message: "Agent changes",
            author: { name: "A", email: "a@example.com", timestamp: 1 },
            parent: ["base-commit"],
          },
        ])
        .mockResolvedValueOnce([
          {
            oid: "base-commit",
            message: "Base",
            author: { name: "B", email: "b@example.com", timestamp: 1 },
            parent: [],
          },
        ]),
    }

    await expect(
      Effect.runPromise(
        hasBranchCommitsBeyondBase({
          git,
          repoRoot: "/repo",
          branchName: "c0-agent/session-1",
          baseBranch: "main",
        }),
      ),
    ).resolves.toBe(true)
  })

  it("keeps a clean branch with no commits beyond base blocked", async () => {
    const git = {
      log: vi.fn().mockResolvedValue([
        {
          oid: "base-commit",
          message: "Base",
          author: { name: "B", email: "b@example.com", timestamp: 1 },
          parent: [],
        },
      ]),
    }

    await expect(
      Effect.runPromise(
        hasBranchCommitsBeyondBase({
          git,
          repoRoot: "/repo",
          branchName: "c0-agent/session-1",
          baseBranch: "main",
        }),
      ),
    ).resolves.toBe(false)
  })
})
