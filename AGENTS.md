# pi-cursor

Public `pi-cursor-inference` package: Cursor as a plain inference provider over
`aiserver.v1.InferenceService/RunInference`. The complete reachable history passed
[`docs/public-history-audit-2026-09-03.md`](docs/public-history-audit-2026-09-03.md) before the
repository visibility change. The operator authorized the first functional `0.0.1` release on
2026-09-03; Changesets, GitHub Actions, npm OIDC, and exact-artifact verification own publication.

Read [`docs/plan.md`](docs/plan.md) and [`docs/decisions.md`](docs/decisions.md) before changing
anything. Decisions outrank the current source shape; record a new decision in the same change
that acts on it.

## Rules

- One implementation artifact: minified `dist/index.mjs`, no source map, plus the minimal
  declaration for the extension entry. `files` is a whitelist; `pack:verify` enforces it.
- `@victor-software-house/pi-type-kit` and `@victor-software-house/pi-components` are the only
  permitted private build dependencies. Import exact named helpers, bundle them, and prove unused
  modules/package names/source paths are absent from `dist/index.mjs`. Pi peers are the only
  external runtime imports.
- Machine identity is derived from the host with Cursor's algorithm (see decisions). Never read an
  installed IDE, never invent ids silently; the UUID fallback is persisted and reported.
- Credentials go through Pi's OAuth provider contract. No custom stores.
- Keep evidence classes separate: pinned IDE source, application-message captures, Pi 0.84.4 tag.
  No packet-level claims. No credential, machine id, account id, or billing value in fixtures.
- Recoverable failures notify through `ctx.ui.notify` and continue; `console.*` is not an operator
  channel.
- Tasks live in `mise.toml`; `mise run verify` is the single gate for hooks and CI.
- Conventional Commits; commit and push each green slice; no AI attribution anywhere.
- The GitHub repository and npm package are public. Never publish, version, tag, or edit the
  changelog manually; author patch changesets and let the release workflow own those operations.
- `0.0.1` is the first functional release from the blank `0.0.0` reservation. Do not create a
  different first version or bypass the Version Packages PR and exact-artifact gates.
- Port only provider registration, OAuth login/refresh, host identity, catalog preflight,
  RunInference request/transport/stream mapping, the `/cursor` Usage/Settings action menu, usage
  pane, reconciliation settings, and narrow tests. Do not carry account/database abstractions,
  multi-account, keychain/1Password support, extraction machinery, or broad protos.
