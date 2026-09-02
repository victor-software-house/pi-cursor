# pi-cursor plan

Decisions that shaped this plan: [`decisions.md`](decisions.md).

## Outcome

`pi install npm:pi-cursor-inference` gives a Pi user a `cursor` provider that logs in with `/login cursor`,
lists the account's Cursor models, and streams thinking, text, usage, and incremental tool-call
arguments through `aiserver.v1.InferenceService/RunInference`. Pi owns every tool: it sends its
complete context and active tool schemas, executes calls through its ordinary loop, and continues
on the same routed run. No agent bridge, no Cursor-owned tools, no hidden checkpoint state.

Done when an exact published `pi-cursor-inference@0.0.1` is installed from npm into a clean Pi 0.84.4
(Node CLI and official standalone Bun binary), logs in through the browser flow, refreshes an
expiring token, and completes a streamed arbitrary-tool round trip on Composer 2.5 plus one row
from each other model family the account exposes.

## Non-goals

- `agent.v1.AgentService/Run`, MCP projection, exec bridge, Cursor-native tools, any compatibility mode.
- Usage/billing dashboard, `/cursor` command surface, multi-account, 1Password or SQLite storage.
- Packet-level HTTP/2 claims (DATA boundaries, HPACK, compression bytes, header order).
- Reproducing the private repository's DMG extraction and drift gates.

## Source facts the plan stands on

| Fact | Source |
|:--|:--|
| Wire schema: 54 messages, 4 enums, `InferenceService` with BiDi `RunInference` | Cursor IDE 3.18.9, commit `2ba48ff3f7514cc4643c52ca9f7b3173d9b66130`, modules `657.js:8844`, `657.js:4410` |
| Transport headers, cookie, checksum algorithm | `657.js:41033` |
| Run handshake, invocation multiplexing, tool mapping, `{ jsonSchema }` tool envelope | `675.js:40675` |
| Machine identity derivation | `main.js` `id.js` / `macAddress.js` / `telemetryUtils.js` (same in 3.18.9 and 3.18.25); local recomputation equals the IDE's stored values |
| Login: `loginDeepControl` challenge, `POST /auth/poll`, 60-day access JWT | captured `cursor-agent 2026.08.25` login (private repo doc 2026-08-25) |
| Token refresh: `POST https://api2.cursor.sh/auth/exchange_user_api_key` | oh-my-pi prior art only; **unmeasured**, must be captured before release |
| Catalog RPCs: `AvailableModels`, `GetUsableModels`, `GetDefaultModelForCli` | current CLI captures; `GetServerConfig` is not an inference authority |
| Live proof of the approach | private provider streamed arbitrary tools with argument deltas and continuation on Composer 2.5, GPT-5.6 Sol, Claude Opus 5 Thinking, Gemini 3.7 Flash, Cursor Grok 4.6 |

## Architecture

```text
src/
  index.ts              registerProvider: models from catalog, auth.oauth, stream = streamCursor
  auth.ts               PKCE challenge, browser URL, /auth/poll, refresh, JWT expiry
  identity.ts           machineId / macMachineId derivation (Cursor algorithm), UUID fallback
  headers.ts            static IDE identity, checksum, cookie, client key, CR/LF rejection
  transport.ts          node:http2 session per account, RunInference run registry, invocation
                        multiplexer, cancel, finishRun, bounded shutdown
  request.ts            Pi Context -> InferenceStreamRequest (system, user, images, assistant,
                        reasoning, tool calls, tool results, tools with { jsonSchema })
  stream.ts             server parts -> Pi events (thinking/text/toolcall deltas, usage, stop)
  catalog.ts            three-surface preflight, model decomposition, 10-minute in-memory cache
  image.ts              image part validation
  gen/                  @bufbuild/protobuf classes generated from proto/ (bundled, gitignored)
proto/
  aiserver/v1/inference.proto        reconstructed from 3.18.9 metadata
  agent/v1/*.proto, aiserver/v1/*    catalog request/response closure only
  artifact-lock.json                 version, commit, URL, DMG sha256, module ids
docs/
  plan.md, decisions.md, protocol.md (wire contract summary + provenance)
test/
  unit/     identity fixtures, headers census, transport against a local HTTP/2 server,
            request mapping, stream mapper, corpus replay, catalog decomposition, auth parsing
  live/     gated: login poll parser against real endpoint, Composer round trip, model matrix
  fixtures/ tool-roundtrip.json (synthetic, secret-free)
```

Runtime dependencies: `@bufbuild/protobuf`, `zod`, `ts-pattern`. Peers: `@earendil-works/pi-ai`,
`pi-coding-agent`, `pi-tui` at `0.84.4`. `@victor-software-house/pi-type-kit` is a bundled
dev dependency (private registry; see decisions).

## Slices

Each slice ends committed, pushed, and green on `mise run verify`.

### 0. Scaffold and contract (this slice)

- Repository, mani registration, `docs/plan.md`, `docs/decisions.md`, `AGENTS.md`, `CLAUDE.md`.
- VSH scaffold baseline (`pi-extension-scaffold`) adapted for public npm: `publishConfig.access: public`,
  no GitHub Packages publish, Changesets + OIDC trusted publishing per `greenfield-release`.
- `tsdown`: single entry, `minify: true`, `sourcemap: false`, entry-only declarations, `clean`,
  Pi peers in `deps.neverBundle`; `files: ["dist", "README.md", "CHANGELOG.md", "LICENSE"]`.
- Verify: `mise run verify` passes on an empty extension that registers nothing.

### 1. Protocol and identity

- Copy `inference.proto`, catalog protos, and `artifact-lock.json`; `buf.gen.yaml` generating only the
  RunInference closure and the three catalog RPC closures into `src/gen/` (`erasable_syntax`, no `.js`
  import extension).
- `identity.ts`: platform command table exactly as Cursor's `J6`, hardware-id normalisation exactly as
  `H9e`, MAC selection exactly as `B9e`/`W9e`, SHA-256 hex; random-UUID fallback persisted under
  `getAgentDir()/pi-cursor/identity.json` only when derivation fails.
- `headers.ts`: checksum with minute stamp and both/one-id shapes; static IDE identity; os/arch from
  process; 32-byte client key; header value validation.
- Verify: unit tests with fixed inputs for every platform branch; a darwin test that recomputes the
  values and, when `PI_CURSOR_IDE_STORAGE` points at a real `storage.json`, asserts equality;
  checksum vector test against a value produced by the private implementation.

### 2. Transport, request, stream

- Port `inference-transport.ts`, `inference-request.ts`, `inference-stream.ts`, `stream.ts`, `image.ts`
  with `pi-type-kit` helpers kept as bundled imports.
- Verify: the private repository's transport matrix against a real local Node HTTP/2 server
  (handshake, one `runReady`, interleaved and reverse completion, unknown/duplicate/late ids,
  cancellation leaving siblings live, `finishRun` on routing change, heartbeats, compression, trailer,
  data-after-trailer, EOF, GOAWAY, bounded shutdown); request matrix (system, user text/images,
  assistant text/thinking/tool calls, tool results incl. image results, cross-provider history,
  malformed tool schema rejection); `tool-roundtrip.json` replays to one `toolUse`, one correlated
  continuation, final `stop`.

### 3. Provider registration, catalog, login

- `catalog.ts`: `AvailableModels` + `GetUsableModels` + `GetDefaultModelForCli` unary calls over the
  same HTTP/2 session; decomposition into Pi models with thinking levels and max mode; in-memory
  10-minute cache keyed by credential digest; no stale fallback.
- `auth.ts`: `createProvider({ auth: { oauth: { login, refreshToken, getApiKey } } })`. `login` opens
  `https://cursor.com/loginDeepControl?challenge=<S256>&uuid=<v4>&mode=login&redirectTarget=cli`
  through `callbacks.openUrl`, polls `POST https://api2.cursor.sh/auth/poll` on the captured bounded
  policy until the access/refresh pair arrives, stores `{ refresh, access, expires }` from the JWT
  `exp`. `refreshToken` posts the refresh token to `auth/exchange_user_api_key`; before this slice
  closes the exchange must be captured once against the real endpoint and its request/response shape
  pinned in `docs/protocol.md`. `PI_CURSOR_TOKEN` short-circuits both for headless use.
- `index.ts`: register `cursor`; models resolved at `session_start` after credentials exist; failures
  notify through `ctx.ui.notify` and continue; reload finishes runs and rebuilds the runtime;
  shutdown closes sessions.
- Verify: unit tests for challenge/verifier derivation, poll response parsing and bounded retry,
  JWT expiry extraction, credential-missing registration behaviour; `mise run dev` isolated TUI
  performs `/login cursor` end to end and lists models.

### 4. Packaging gates

- `mise run build` emits exactly `dist/index.mjs`; `pack:verify` runs `bun pm pack`, lists the
  tarball, fails on any file outside the whitelist, any `sourceMappingURL`, any `//` or `/* */`
  comment longer than a license banner, any `.map`, `.d.mts`, `proto`, `test`, or `docs` path,
  and any string containing `victor-software-house/pi-stuff` or a local filesystem path.
- Packed smoke: extract the tarball into an empty directory and load the extension through the
  Node CLI and the checksum-verified official standalone Bun binary with `--no-extensions -e`,
  asserting the provider registers with a synthetic token against a loopback transport.
- Verify: `mise run verify` includes build, pack:verify, unit, and packed smoke.

### 5. Live proof

- Isolated dev TUI (`mise run dev`) in a visible pane: `/login cursor`, model list, Composer 2.5
  bash-tool round trip, one row each for GPT-5.6 Sol, Claude Opus 5 Thinking, Gemini 3.7 Flash,
  Cursor Grok 4.6 through the account that exposes them; a forced near-expiry refresh.
- Gated `test/live/` suite records secret-free application messages for the Composer round trip and
  asserts argument deltas, correlated tool result, and final text.
- Verify: retained live report; no secret, machine id, or account id in any committed fixture.

### 6. Release

- Bootstrap: manual `bun publish --access public` of `0.0.0` from a verified tree, tag `v0.0.0`,
  configure npm trusted publishing for `release.yml`; then the first patch Changeset produces
  `0.0.1` through the Version Packages PR and OIDC publish.
- Flip the repository to public before `0.0.1` publishes; README states provenance, the IDE
  identity derivation, the unverified-server-policy caveat for derived identities, the third-party
  client risk under Cursor's terms, and the exact evidence classes.
- Installed proof: `pi install npm:pi-cursor-inference@0.0.1` into a clean agent dir, Node and standalone Bun,
  `/login cursor`, and the Composer round trip. Record the evidence in the release notes.

## Risks and stop conditions

| Risk | Response |
|:--|:--|
| Refresh endpoint shape differs from prior art | Capture once in slice 3; do not ship an unmeasured refresh |
| Server rejects derived identity from a non-IDE host | Only measurable on a machine without the IDE; test on a clean VM before release, document result |
| Linux/Windows identity branches cannot be executed here | Fixture tests only; mark those platforms “derived per Cursor source, not host-verified” in README |
| Cursor changes `RunInference` or identity headers | Artifact lock pins the source version; README states the pinned IDE version and that drift is expected |
| Minified bundle still exposes the schema | Accepted; state plainly in README that minification is not protection |

## Deferred

Multi-account, usage dashboard, Linux/Windows host verification, a public drift gate, browser login
without `redirectTarget=cli`.
