# pi-cursor release-readiness plan

> **Status:** Implementation and release-candidate proof completed 2026-09-03. Publication remains
> disabled until the operator explicitly authorizes it.

Decisions that govern this plan: [`decisions.md`](decisions.md).

## Outcome

The repository contains an installable Pi extension artifact that registers a native `cursor`
provider and `/cursor` usage command. It uses Cursor's
`aiserver.v1.InferenceService/RunInference` transport. Cursor supplies inference; Pi owns complete
context, arbitrary tool schemas, execution, continuation, branching, and transcript.

The functional implementation is not the public npm package yet. The existing
`pi-cursor-inference@0.0.0` is a blank name reservation. The repository stays private,
`package.json` stays `private: true`, and no release workflow or functional npm version is created
without a separate operator decision.

## Scope

- Native Pi OAuth login and refresh, plus `PI_CURSOR_TOKEN` for headless use.
- Host-derived Cursor machine identity without reading an installed IDE.
- Three-surface catalog preflight and fail-closed dynamic model refresh.
- Catalog-backed context, image/thinking capabilities, and meaningful Max Mode rows.
- RunInference request, HTTP/2 transport, multiplexing, stream mapping, and tool continuation.
- Single-account DashboardService usage data and `/cursor` Summary/Models pane.
- Deterministic unit, protocol, build, packed-loader, and package-shape gates.
- Bounded local-only live catalog, usage, provider, and visible TUI proof.

## Non-goals

- `agent.v1.AgentService/Run`, Cursor-native tools, MCP projection, or an agent bridge.
- Multi-account storage, SQLite, keychain/1Password readers, or installed-IDE extraction.
- Reproducing the private repository's broad capture and drift machinery.
- Packet-level HTTP/2 claims such as DATA boundaries, HPACK state, compression bytes, or original
  header order.
- Inventing Grok thinking text when RunInference supplies only an opaque continuation signature.
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
  reconciliation.ts     strict streamed/final text, reasoning, and tool reconciliation
  dashboard.ts          measured DashboardService unary transport
  usage.ts              standard/Enterprise usage aggregation and partial misses
  usage-view.ts         unit-correct text, bars, sparklines, and model rows
  usage-panel.ts        keybinding-aware Summary/Models TUI component
  command.ts            /cursor, /cursor usage, /cursor help
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

The published whitelist is `package.json`, README, CHANGELOG, LICENSE,
`dist/index.mjs`, and `dist/index.d.mts`. Generated protocol code and
`@victor-software-house/pi-type-kit` helpers are bundled. Pi peers remain external.

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
- Final response reconciliation keeps final text/tools authoritative while retaining streamed
  thinking when final reasoning contains only redacted or signature metadata.
- Completed streamed tools must match final tools by ID, name, and deep-equal arguments. Text
  differences produce payload-free structural diagnostics rather than prefix matching or warnings.
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

### 4. `/cursor` usage surface

- `/cursor` and `/cursor usage` open the single-account usage surface; `/cursor help` prints the
  compact command shape.
- TUI mode provides Summary/Models, Tab switching, `r` refresh, configured cancel handling, and
  `q` close.
- Outside TUI mode, print writes plain text, JSON emits a custom message event, and RPC uses a
  notification.
- Standard plans render measured percentages and on-demand policy. Enterprise renders cumulative
  current/previous spend and per-model breakdowns.
- Optional call failures remain visible as named misses. Required-call failures fail visibly.

### 5. Deterministic package gate

`mise run verify` passes with:

- Biome, oxlint, actionlint, and TypeScript;
- 95 unit tests with one explicit host-only identity test skipped;
- a minified 89.34 kB ESM bundle plus entry declaration;
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
- every live inference result asserting the runtime's structural reconciliation diagnostic;
- a paid arbitrary-tool turn whose completed streamed/final tools match exactly before its local
  result continues on the same routed run;
- an isolated visible Pi TUI in a Herdr pane showing live Enterprise Summary and Models views;
- Tab switching and `q` close;
- visible partial-failure handling when one aggregate sample timed out.

The temporary token, Ego Browser task space, and Herdr test pane were removed afterward.

## Remaining publication gates

These steps are intentionally unstarted and require an explicit operator decision:

1. Authorize the first functional public release.
2. Make the GitHub repository public and remove `private: true` from `package.json` in the same
   release-enablement change.
3. Add and review the npm OIDC/Changesets release workflow; configure npm trusted publishing for
   that exact workflow.
4. Add a patch Changeset for the first functional `0.0.1` release. Do not alter the existing blank
   `0.0.0` package manually.
5. Merge the generated Version Packages PR only after its current head passes CI and package gates.
6. Let CI publish `0.0.1`; do not publish, tag, or edit changelogs from a terminal.
7. In a clean agent directory, install the exact npm version, run `/login cursor`, confirm the
   provider catalog and `/cursor` pane, and perform one bounded Composer response.
8. Verify npm metadata, tag target, GitHub Release, and exact-version Node/Bun load before calling
   the release complete.

## Known boundaries

- Darwin identity and the current paid account path are live-verified. Linux and Windows identity
  logic is source-derived and fixture-tested, not host-verified.
- Cursor is a closed service and can drift beyond the pinned clients. The deterministic gates prove
  the selected contract, not future server compatibility.
- Minification and selective packaging reduce accidental disclosure; they do not protect a public
  wire schema from inspection.
- The usage backend can return partial aggregate timeouts. The pane reports the missing sample and
  renders the available data rather than fabricating a value.
