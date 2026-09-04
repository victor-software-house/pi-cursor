# pi-cursor release-readiness plan

> **Status:** `pi-cursor-inference@0.0.2` released 2026-09-03. npm integrity, exact tag and
> GitHub Release, clean Pi installation, corrected README links, and pi.dev's native 4K 16:9
> gallery rendering are verified.

Decisions that govern this plan: [`decisions.md`](decisions.md).

## Outcome

The repository contains an installable Pi extension artifact that registers a native `cursor`
provider and `/cursor` Usage/Settings action menu. It uses Cursor's
`aiserver.v1.InferenceService/RunInference` transport. Cursor supplies inference; Pi owns complete
context, arbitrary tool schemas, execution, continuation, branching, and transcript.

The functional implementation begins with `pi-cursor-inference@0.0.1`; the existing `0.0.0` is a
blank name reservation. The repository's reachable history passed
[`public-history-audit-2026-09-03.md`](public-history-audit-2026-09-03.md) before visibility changed
to public. Versioning, changelog generation, npm OIDC publication, tags, and GitHub Releases are
owned by Changesets and the main-branch release workflow.

## Scope

- Native Pi OAuth login and refresh, plus `PI_CURSOR_TOKEN` for headless use.
- Host-derived Cursor machine identity without reading an installed IDE.
- Three-surface catalog preflight and fail-closed dynamic model refresh.
- Catalog-backed context, image/thinking capabilities, and meaningful Max Mode rows.
- RunInference request, HTTP/2 transport, multiplexing, stream mapping, and tool continuation.
- Single-account DashboardService usage data and `/cursor` Summary/Models pane.
- Persisted settings for strict final reconciliation and assistant-message diagnostics.
- Deterministic unit, protocol, build, packed-loader, and package-shape gates.
- Bounded local-only live catalog, usage, provider, and visible TUI proof.

## Non-goals

- `agent.v1.AgentService/Run`, Cursor-native tools, MCP projection, or an agent bridge.
- Multi-account storage, SQLite, keychain/1Password readers, or installed-IDE extraction.
- Reproducing the private repository's broad capture and drift machinery.
- Packet-level HTTP/2 claims such as DATA boundaries, HPACK state, compression bytes, or original
  header order.
- Synthesizing Grok thinking text when RunInference supplies only an opaque continuation signature.
- Publication, repository visibility changes, versioning, tags, or npm replacement in this plan.

## Evidence baseline

| Contract | Pinned evidence |
|:--|:--|
| RunInference schema and service | Cursor IDE 3.18.9, commit `2ba48ff3f7514cc4643c52ca9f7b3173d9b66130`, modules `657.js:8844` and `657.js:4410` |
| Transport headers, cookie, checksum | Cursor IDE 3.18.9 module `657.js:41033` |
| Run multiplexing and tool mapping | Cursor IDE 3.18.9 module `675.js:40675` |
| Login and workbench refresh | Captured login plus pinned IDE 3.18.9 workbench; live refresh measured 2026-09-02 |
| Catalog and DashboardService | `cursor-agent 2026.09.02-fa0c06e` selected schema and application-message captures |
| Pi extension/provider contract | `@earendil-works/pi-*` 0.84.4 |
| Grok reasoning limitation | Bounded RunInference measurements: opaque signature present, reasoning text absent |

## Architecture

```text
src/
  index.ts              extension entry; provider and command registration
  auth.ts               browser login, poll, refresh, JWT expiry
  identity.ts           host machine/mac identity and persisted UUID fallback
  headers.ts            IDE request identity and checksum
  catalog.ts            three unary catalog calls, family/base join, 10-minute cache
  provider.ts           native Pi provider, auth, model refresh, runtime ownership
  request.ts            Pi Context and arbitrary tools to RunInference messages
  transport.ts          HTTP/2 session, routed runs, invocation multiplexing, shutdown
  stream.ts             RunInference response arms to Pi assistant events
  reconciliation.ts     streamed/final text, reasoning, and optional strict tool reconciliation
  settings.ts           validated owner-only persisted settings and process snapshot
  menu-panel.ts         pi-components Usage/Settings action selector
  settings-panel.ts     pi-components reconciliation and diagnostics toggles
  dashboard.ts          measured DashboardService unary transport
  usage.ts              standard/Enterprise usage aggregation and partial misses
  usage-view.ts         unit-correct text, bars, sparklines, and model rows
  usage-panel.ts        keybinding-aware Summary/Models TUI component
  command.ts            /cursor menu, /cursor usage, /cursor settings, /cursor help
proto/
  agent/v1/catalog.proto
  aiserver/v1/catalog.proto
  aiserver/v1/dashboard.proto
  aiserver/v1/inference.proto
scripts/
  dev.ts                isolated source TUI
  pack-verify.ts        tarball, bundle, Node/Bun, and Pi-loader gate
test/
  unit/                 deterministic behavior and protocol tests
  live/                 credential- and CI-gated catalog, usage, and provider checks
```

The published whitelist is `package.json`, README, CHANGELOG, LICENSE, the paired Quarter Turn
banners/marks, static Pi gallery PNG, `docs/brand.md`, `dist/index.mjs`, and `dist/index.d.mts`. Generated protocol code,
`@victor-software-house/pi-type-kit`, and `@victor-software-house/pi-components` helpers are
bundled. Pi peers remain external. The component package's Node 26 engine governs its unbundled
package; the emitted extension targets Node 24 and imports only Pi peers at runtime.

## Completed slices

### 1. Protocol, identity, request, transport, and stream

- Selected RunInference closure pinned by source hashes and generated-message counts.
- Cursor machine and MAC identity algorithm implemented for supported platforms.
- Request mapping preserves full Pi context, images, arbitrary JSON Schema tools, tool results,
  and cross-provider history.
- Transport covers routed-run replacement, invocation multiplexing, cancellation, correlation,
  retries, EOF, and shutdown.
- Stream mapping preserves thinking text, opaque signatures, final response messages, usage,
  provider metadata, image descriptions, and diagnostics.
- Final response assembly keeps final text/tools authoritative while always retaining streamed
  thinking when final reasoning contains only redacted or signature metadata.
- Strict reconciliation defaults on and requires completed streamed tools to match final tools by
  ID, name, and deep-equal arguments. Operators can disable only these cross-copy equality checks.
- The text/reasoning reconciliation census is payload-free and persisted only when diagnostics are
  explicitly enabled. The opt-in diagnostic can also retain provider side-channel metadata;
  diagnostics default off and add nothing to assistant messages.
- Multi-block reasoning metadata matches by exact signature or exact text. Only a single unmatched
  metadata block and single unmatched text block may merge by cardinality; every other unmatched
  metadata block remains separate.

### 2. OAuth and provider registration

- `/login cursor` uses the measured PKCE verifier-string challenge and workbench poll headers.
- Refresh uses the measured IDE workbench `/oauth/token` grant and retains the durable refresh JWT.
- Pi owns credential persistence and refresh. No custom credential store exists.
- Provider model refresh fails closed and clears stale in-memory and persisted catalog rows.

### 3. Catalog metadata and Max Mode

- Selectable `GetUsableModels` families join to `AvailableModels` rows through names, aliases,
  legacy slugs, and variant legacy slugs.
- Matching rows supply context windows, image support, and thinking support.
- Grok 4.6 reports 256k and receives no redundant Max row because its captured normal and Max
  metadata are equivalent.
- GPT-5.6 Sol reports 272k normally and a distinct 1M `-max` row.
- Catalog-selected context parameters flow into both the requested model and routing key.
- Unmatched families retain conservative 200k fallback metadata.

### 4. `/cursor` operator surface

- Bare `/cursor` opens a bundled pi-components selector with Usage and Settings actions.
- `/cursor usage` opens the single-account usage surface; `/cursor settings` persists strict
  reconciliation and diagnostic toggles; `/cursor help` prints the compact command shape.
- TUI mode provides Summary/Models, Tab switching, `r` refresh, configured cancel handling, and
  `q` close.
- Outside TUI mode, print writes plain text, JSON emits a custom message event, and RPC uses a
  notification.
- Standard plans render measured percentages and on-demand policy. Enterprise renders cumulative
  current/previous spend and per-model breakdowns.
- Optional call failures remain visible as named misses. Required-call failures fail visibly.
- RunInference token arms populate Pi's input, output, cache-read, cache-write, and total fields on
  each assistant response. RunInference exposes no typed billed-cost field, so Pi's per-response
  cost is zero.
- The pinned client schema also includes DashboardService `GetFilteredUsageEvents`. Its rows carry
  per-event token cost, Cursor Token fee, actual charged cents, timestamp, model, client type, and
  optional conversation ID. The current pane calls only aggregate methods, and filtered-endpoint
  account/role access has not been live-verified for this package.
- DashboardService also defines `GetClientUsageData(conversationId, timestampBeforeRequest)`, which
  returns named costs in cents. Full packaged-source searches find no client caller or response-field
  consumer, so its timestamp unit, item meanings, settlement timing, and concurrency behavior remain
  unestablished.
- `AiService.CheckUsageBasedPrice` returns a quote for supplied usage-event details and is called
  only by the workbench's usage-based-pricing preflight display. It has no call identifier and is not
  post-response measured usage.
- DashboardService and official Admin API usage-event rows expose `conversationId` rather than
  RunInference's per-call `invocationId`. `GetClientUsageData` adds a time boundary but no
  invocation identifier. Because pi-cursor uses one conversation ID for the Pi session, the pinned
  contracts do not establish an exact identifier-level join from monetary values to individual Pi
  messages.
- Cursor Agent SDK `get_usage()` cost data is outside scope because it belongs to Cursor's agent
  runtime rather than the Pi-owned inference loop.

### 5. Deterministic package gate

`mise run verify` passes with:

- Biome, oxlint, actionlint, and TypeScript;
- 105 unit tests with one explicit host-only identity test skipped;
- a minified 98.64 kB ESM bundle plus entry declaration;
- publint and exact tarball whitelist checks;
- forbidden package/path/source-map scans and bundle-size limits;
- extracted-artifact imports under Node and Bun, each with a five-second process guard;
- loading through Pi's real extension loader, which must register `/cursor` and exactly one native
  `cursor` provider;
- packed `/cursor help` checks that require print text and a JSON custom-message event.

### 6. Live release-candidate proof

A fresh OAuth login on 2026-09-03 supplied a temporary token used only for the proof. The following
passed:

- all three live catalog calls and selectable-model construction;
- live DashboardService usage shape without printing account values from the test;
- one bounded Composer 2.5 production RunInference response with a 256-token output cap;
- a bounded `default` router response whose non-empty streamed thinking remains in the finalized
  assistant message;
- every live inference result explicitly enabling and asserting the runtime's structural
  reconciliation census inside the response diagnostic;
- a paid arbitrary-tool turn whose completed streamed/final tools match exactly before its local
  result continues on the same routed run;
- an isolated visible Pi TUI in a Herdr pane showing live Enterprise Summary and Models views;
- Tab switching and `q` close;
- visible partial-failure handling when one aggregate sample timed out.

The temporary token, Ego Browser task space, and Herdr test pane were removed afterward.

## Release execution gates

All authorized `0.0.1` gates completed:

1. The release-enablement changeset passed CI and generated the Version Packages PR.
2. The App-authored Version Packages PR independently passed CI and was merged at its exact head.
3. npm trusted publishing was configured for this repository and `release.yml` with publish
   permission.
4. Actions published `0.0.1`, created the exact tag, and created the GitHub Release.
5. A clean agent directory installed `npm:pi-cursor-inference@0.0.1`; Pi loaded it and a visible
   Cursor-provider turn preserved thinking and final text.
6. npm integrity, the tag target, GitHub Release, and pi.dev extension/gallery listing were verified.

## Release verification

Completed for `0.0.1`:

1. Version Packages PR [#1](https://github.com/victor-software-house/pi-cursor/pull/1) contained
   only the consumed changeset, `CHANGELOG.md`, and the `0.0.1` manifest bump; its CI passed.
2. npm trusted publishing was created for `victor-software-house/pi-cursor` and `release.yml` with
   publish permission. The workflow minted the OIDC token and published with Bun.
3. The first publish reached npm successfully but the immediate clean Bun smoke raced registry
   propagation. The exact-run retry was idempotent: it skipped the existing version, then created
   and verified `v0.0.1` and the GitHub Release.
4. The registry's SHA-512 integrity equals the independently downloaded tarball. The tag peels to
   the exact version commit `f6e94fcf989d68a5d7fb4ddd13a0c7007aacf123`.
5. `pi install npm:pi-cursor-inference@0.0.1` installed into a clean agent directory. Pi 0.84.4
   reported `pi-cursor-inference@0.0.1:dist`; `/cursor help` worked, and a visible Herdr session
   routed a Gemini 3.7 Flash proof through `cursor`, retaining displayed thinking and final text.
6. `https://pi.dev/packages/pi-cursor-inference` classifies `0.0.1` as an extension, renders the
   gallery image, exposes the install command, and displays the exact `pi` manifest.

Completed for `0.0.2`:

1. Version Packages PR [#2](https://github.com/victor-software-house/pi-cursor/pull/2) contained
   only the consumed changeset, `CHANGELOG.md`, and the `0.0.2` manifest bump; its CI passed and it
   merged at `c06db4a400ec2c9cd507f7707e5d0a712dfe3bf0`.
2. npm accepted the OIDC-authenticated Bun publication while its package-publishing service was
   degraded, but registry visibility exceeded the workflow's 90-second wait. After npm exposed the
   accepted version, the exact-run retry skipped publication and created `v0.0.2` plus its GitHub
   Release at the version commit.
3. The independently downloaded tarball matches npm's SHA-512 integrity, and a clean
   `pi install npm:pi-cursor-inference@0.0.2` installs the exact version and extension manifest.
4. pi.dev displays `0.0.2`, resolves the implementation links to GitHub, and renders the
   `3840×2160` gallery image at its exact 16:9 card size without cropping.

The immutable published `0.0.1` README's final relative links resolve through jsDelivr to omitted
files and return 404. `0.0.2` replaces them with absolute GitHub links and carries the corrected 4K
16:9 gallery image. Runtime behavior is unchanged.

The npm packument does not expose a `dist.attestations` field for these Bun 1.4 publications. The
workflow logs prove trusted-publisher OIDC token minting and successful publication, but do not
claim a separate npm provenance attestation.

## Known boundaries

- Darwin identity and the current paid account path are live-verified. Linux and Windows identity
  logic is source-derived and fixture-tested, not host-verified.
- Filtered DashboardService usage events and `GetClientUsageData` are source-verified but not
  live-verified for the current account role. Neither contract has a RunInference invocation ID;
  the packaged client does not call either method, and `GetClientUsageData` semantics cannot be
  recovered from generated fields alone.
- Cursor is a closed service and can drift beyond the pinned clients. The deterministic gates prove
  the selected contract, not future server compatibility.
- Minification and selective packaging reduce accidental disclosure; they do not protect a public
  wire schema from inspection.
- The usage backend can return partial aggregate timeouts. The pane reports the missing sample and
  renders the available data rather than fabricating a value.
