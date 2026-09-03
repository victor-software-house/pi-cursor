# pi-cursor

Private proof of concept, resumed 2026-09-02: Cursor as a plain inference provider over
`aiserver.v1.InferenceService/RunInference`. The public `pi-cursor-inference@0.0.0` package remains
a blank name reservation; release automation stays disabled pending an explicit operator decision.

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
- Tasks live in `mise.toml`; `mise run verify` is the single gate for hooks and CI.
- Conventional Commits; commit and push each green slice; no AI attribution anywhere.
- Keep the GitHub repository private and `package.json` marked `private: true`.
- Never publish another npm version, create a Version Packages PR, or replace the blank `0.0.0`
  placeholder. Do not resume release work without a new explicit operator decision.
- Port only provider registration, OAuth login/refresh, host identity, catalog preflight,
  RunInference request/transport/stream mapping, the `/cursor usage` pane (added 2026-09-02 by
  operator decision, ported from the private stack's measured implementation), and narrow tests. Do
  not carry account/database abstractions, multi-account, keychain/1Password support, extraction
  machinery, or broad protos.
