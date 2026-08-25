## solzero@1.6.0

### Bots can create standing and temporary routines

Each bot can create its own routines. Standing routines keep running until the bot deletes them. Temporary routines watch finite work such as pull request checks and are deleted when that work is done or when the deadline passes.

### Safer decode at bot, session, workflow, and alarm edges

SolZero now parses untrusted bot, session, workflow, and alarm payloads before they reach runtime code. Operators see safer decode of stored rows, manifests, and artifact metadata.

### Alchemy 2.0.0-beta.74 and Turbo 2.10.11

SolZero now deploys and builds with Alchemy 2.0.0-beta.74 and Turbo 2.10.11. The next deploy adopts existing D1 migration history into Alchemy's migration table. Operators do not need a special action beyond that deploy.

### Deploy previews from GitHub Actions

The new `Deploy Preview` workflow deploys the `pre` stage on each merge to `master`. Each pull
request deploys an ephemeral `pre-<number>` stage and posts its preview URL as a pull request
comment. The workflow destroys the ephemeral stage when the pull request closes. A manual dispatch
input removes an orphaned `pre-*` stage.

The `Release` workflow now starts after `Deploy Preview` succeeds on `master`. Deployment operators
must set the GitHub `pre` environment secrets and the repository Cloudflare secrets. Run
`nub run github:sync-env-secrets` to upload them.

### Show the real product version in the app

The web sidebar and the API health endpoint now display the product version from the repository
`VERSION` file, followed by the short commit hash of the deployed build, for example
`v1.5.0-036d0b`. Deployments previously displayed `v0.0.0` because they read the placeholder
workspace package version.

A build that contains commits after the release tag also shows the unreleased commit count, for
example `v1.5.0+2-bbb222`. A build deployed from the release tag itself, such as a production
deployment, keeps the plain `v1.5.0-036d0b` form. The count needs the release tag and full history
in the deploy checkout; without them the label omits the count.

## solzero@1.5.0

### Route model traffic through Cloudflare AI Gateway

<!-- creative: {"title":"Send every model through one reliable gateway.","bullets":["Route SolZero agents through Cloudflare AI Gateway.","Manage models and provider keys from one catalog."],"workType":"feature"} -->

SolZero now provisions Cloudflare AI Gateway as its default model gateway. Each deployment profile
can set a model allowlist and choose its default model. Sessions that run in Isolate, OpenCode,
Codex, or Claude Code can select a compatible gateway model.

Administrators can supply provider keys through deployment-managed secrets or the Admin dashboard.
A user can also set a personal provider-key override. SolZero keeps injected container credentials
in trusted Worker code.

Deployment owners must grant the Cloudflare API token edit access to AI Gateway and Secrets Store
before provisioning.

### Publish branded release visuals

<!-- creative: {"title":"Give milestone releases a launch moment.","bullets":["Publish a polished social card for minor and major releases.","Render each card directly from structured release data."],"workType":"feature"} -->

SolZero minor and major releases now include a branded release-notes card. The card uses the SolZero
logo, Manrope font, and Kumo colors. Two layouts support feature summaries with different content
density. Short social copy can sit beside the full technical release note. Work-type badges and
high-contrast bullets make each highlight easier to scan. The structured templates keep each
release image simple and consistent.

Tegami sends the release data to Takumi during minor and major version preparation. Takumi renders
the image through its native Node binding. The version pull request includes the result, and the
GitHub release notes display the card from the release tag. Patch releases use text-only notes.

### Choose between two SolZero loader treatments

<!-- creative: {"title":"See SolZero come alive.","bullets":["Use Clean clockwise as the primary loading indicator.","Preview Form spin as an alternative treatment."],"workType":"ux"} -->

Clean clockwise is now the primary loader across the web app. The Learn More Assets section also
shows Form spin as an alternative treatment. The earlier motion study gallery has been removed so
the page presents only these selected loaders.

### Show sign-in failures in a toast

SolZero now shows failed sign-in messages in a Kumo error toast. The sign-in form stays stable while
the message remains visible and accessible.

### Source and releases live at SolZeroAI/platform

The SolZero platform repository is https://github.com/SolZeroAI/platform. Clone the repository, file
issues, and read GitHub Releases at that URL. After an organization owner renames the GitHub
repository, GitHub redirects https://github.com/SolZeroAI/solzero to the new name.
