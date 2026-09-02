# pi-cursor

Public Pi extension: Cursor as a plain inference provider over
`aiserver.v1.InferenceService/RunInference`. Pi owns context, tools, execution, and transcript;
Cursor owns routed inference.

Read [`docs/plan.md`](docs/plan.md) and [`docs/decisions.md`](docs/decisions.md) before changing
anything. Decisions outrank the current source shape; record a new decision in the same change
that acts on it.

## Rules

- One implementation artifact: minified `dist/index.mjs`, no source map, plus the minimal
  declaration for the extension entry. `files` is a whitelist; `pack:verify` enforces it.
- `@victor-software-house/pi-type-kit` is the sole permitted private build dependency. Import exact
  named helpers, bundle them, and prove unused modules/package names/source paths are absent from
  `dist/index.mjs`. Pi peers are the only external runtime imports.
- Machine identity is derived from the host with Cursor's algorithm (see decisions). Never read an
  installed IDE, never invent ids silently; the UUID fallback is persisted and reported.
- Credentials go through Pi's OAuth provider contract. No custom stores.
- Keep evidence classes separate: pinned IDE source, application-message captures, Pi 0.84.4 tag.
  No packet-level claims. No credential, machine id, account id, or billing value in fixtures.
- Recoverable failures notify through `ctx.ui.notify` and continue; `console.*` is not an operator
  channel.
- Tasks live in `mise.toml`; `mise run verify` is the single gate for hooks, CI, and publish.
- Conventional Commits; commit and push each green slice; no AI attribution anywhere.
- Never `changeset version` or publish from a terminal after the `0.0.0` bootstrap.
- Port only provider registration, OAuth login/refresh, host identity, catalog preflight,
  RunInference request/transport/stream mapping, and narrow tests. Do not carry commands, usage UI,
  database/account abstractions, keychain/1Password support, extraction machinery, or broad protos.
