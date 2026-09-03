# pi-cursor-inference

> ▲ **Release candidate, not published.** The repository remains private and this source package
> remains marked private. The public `pi-cursor-inference@0.0.0` package is still a blank name
> reservation and does not contain this provider.

This repository implements Cursor as an unofficial plain inference provider for
[Pi](https://github.com/earendil-works/pi-mono) over
`aiserver.v1.InferenceService/RunInference`. Cursor supplies inference while Pi owns the complete
conversation, arbitrary tool schemas, tool execution, branching, and transcript.

Publication is intentionally disabled. Do not install the `0.0.0` npm placeholder expecting this
implementation. Enabling the first functional release requires a separate operator decision.

## Features

- Native Pi OAuth through `/login cursor`, plus `PI_CURSOR_TOKEN` for headless use.
- Dynamic model discovery from `AvailableModels`, `GetUsableModels`, and
  `GetDefaultModelForCli`.
- Catalog-backed context windows, image/thinking capabilities, and distinct Max Mode rows only
  when Cursor advertises a meaningful variant difference.
- Streaming thinking text when the provider supplies it, opaque reasoning signatures, text,
  usage, generic tool-call argument deltas, and tool continuations.
- Final response reconciliation preserves routed thinking text when Cursor's final message carries
  only redacted or signature-only reasoning metadata.
- Completed streamed and final tools must match by ID, name, and deep-equal arguments before Pi can
  execute them; final text differences are recorded structurally without prefix heuristics.
- Multi-block reasoning metadata matches only by exact signature or exact text, with an unambiguous
  one-to-one fallback; unmatched metadata stays separate instead of attaching by array index.
- `/cursor` and `/cursor usage` account usage pane with Summary and Models views.

## Usage pane

Run `/cursor` or `/cursor usage` to open the account usage pane. It shows the current plan and
reset date, included and on-demand usage for ordinary plans, or current/previous cumulative spend
for Enterprise plans. When the backend returns a per-model breakdown, **Tab** switches between
**Summary** and **Models**; `r` refreshes and `q`/Esc closes the pane.

The pane uses captured DashboardService calls and renderer-defined units. It does not infer prices
from model tokens or invent values for missing samples. Optional failed calls remain visible as
named misses while available usage still renders. Outside TUI mode, print writes plain text, JSON
emits a custom message event, and RPC uses a notification.

## Configuration

Cursor Max Mode defaults to **off**, matching the IDE's ordinary composer model configuration.
Catalog entries with a distinct Max Mode appear as separate `-max` models and carry Cursor's
captured context parameter automatically. Advanced callers may override the Cursor-specific
`cursorMaxMode` and `cursorContext` sampling parameters per request.

## Verification

`mise run verify` is the deterministic gate. It runs formatting/lint checks, TypeScript checking,
95 unit tests, the minified build, publint, the package whitelist, Node and Bun imports of the
extracted tarball, and Pi's real extension loader. The loader proof requires the packed artifact to
register `/cursor` and exactly one native `cursor` provider. Packed CLI checks also require
`/cursor help` to emit plain text in print mode and a custom message event in JSON mode.

A fresh-account live proof on 2026-09-03 established:

- all three catalog surfaces decode and produce selectable models;
- DashboardService usage loads without exposing account values in test output;
- Composer 2.5 returns text through the production RunInference transport;
- the isolated Pi TUI renders both Summary and Models, switches with Tab, closes with `q`, and
  displays optional aggregate timeouts as named partial misses.
- every live inference result carries payload-free text/reasoning/tool reconciliation diagnostics;
- a paid arbitrary-tool turn proved streamed/final tool equality and continued with the local result.

The implementation is pinned to Cursor IDE 3.18.9 for managed inference and
`cursor-agent 2026.09.02-fa0c06e` for catalog/usage evidence. Darwin host identity is verified
against Cursor's algorithm. Linux and Windows identity branches have deterministic fixtures but
have not been host-verified. Packet-level HTTP/2 framing and future Cursor server compatibility are
not claimed.

## Scope boundary

- No `AgentService/Run`, Cursor-native tools, MCP projection, or agent bridge.
- No multi-account database, keychain/1Password reader, or installed-IDE dependency.
- No invented Grok thinking summary: current RunInference measurements provide an opaque
  continuation signature but no reasoning text for Grok 4.6.
- No publication workflow, public-repository transition, version bump, or npm publish without a
  new operator decision.

See [`docs/plan.md`](docs/plan.md) for completed slices and remaining publication gates, and
[`docs/decisions.md`](docs/decisions.md) for protocol and scope decisions.
