# `@solzero/creative`

`@solzero/creative` owns SolZero release media. It combines typed release data with checked-in brand
assets and deterministic templates.

## Architecture decision

SolZero uses one package for release cards and future product visuals. Shared brand data and layout
components stay in this package. This keeps one source for the release data contract and its visual
system.

[Takumi](https://takumi.kane.tw/docs/) renders images. Its native binding runs in the local CLI and
GitHub Actions. Its WASM binding supports a future Cloudflare Worker entry point. Takumi keyframe
animation can sample the same component tree into WebP, APNG, GIF, or video frames. See the
[keyframe animation guide](https://takumi.kane.tw/docs/keyframe-animation/).

Node-specific file access lives in the `@solzero/creative/node` export. The main export contains the
reusable contracts and components. A future Worker service can render the same components with
`takumi-js/wasm`.

## Release cards

The release-card input stays structured:

```ts
interface ReleaseCardInput {
  version: string
  title: string
  summary?: string
  highlights: Array<{
    title: string
    description: string
    bullets?: string[]
    label?: string
    workType?: ReleaseWorkType
  }>
  also?: string[]
  layout?: "dark-columns" | "light-features"
}
```

The package includes these layouts:

- `dark-columns` places up to four updates in dark Kumo cards.
- `light-features` places up to three primary updates on a light Kumo canvas.

Run the default card from pending Tegami entries:

```sh
nub run creative:release-card
nub run creative:release-card -- --layout dark-columns
```

The command writes `docs/solzero-release-notes.png`. Use `--input path/to/input.json` to provide the
full contract. Use `--version`, `--title`, and `--output` for smaller overrides.

### Social copy

Keep the detailed release note in the section body. Add an invisible creative directive below the
section heading when the card needs shorter social copy:

```md
## Route model traffic through Cloudflare AI Gateway

<!-- creative: {"title":"Send every model through one reliable gateway.","bullets":["Route agents through Cloudflare AI Gateway.","Manage models and provider keys from one catalog."],"workType":"feature"} -->

SolZero now provisions Cloudflare AI Gateway as its default model gateway.
```

The title can contain up to 64 characters. Supply one to three bullets with up to 120 characters
each. The renderer displays the first two bullets with large, high-contrast text and standard round
bullets. A description can provide fallback copy when structured bullets are absent.

Set `workType` to `feature`, `bug`, `ktlo`, `security`, `performance`, `ux`, `docs`, or `breaking`.
Each highlight shows the corresponding badge at its top edge.

The light layout promotes three highlights. The dark layout promotes four. When a release has more
highlights, the remaining titles appear as brief badges in an `Also in vX.Y.Z` footer. The footer
stays hidden when every highlight fits in the primary layout.

Both layouts place the plain SolZero SVG mark and the `SolZero` name at the top left. The lockup has
no frame or background.

## Release flow

Tegami calls the creative release hook after it prepares the version draft. The hook passes the
structured release data to Takumi and writes `docs/solzero-release-notes.png`. The image becomes part
of the version commit. The GitHub release body loads the card from that tag through a stable raw
GitHub URL. Creative directives stay hidden in rendered GitHub Markdown, so the full release note
remains available below the card.

The renderer runs as a native Node function in GitHub Actions. Its inputs come from the repository
checkout and the Tegami draft.

## Planned extensions

- Add keyframe-driven product clips and video-frame export through Takumi.
- Expose the typed template controls through an MCP server and a small template editor.
