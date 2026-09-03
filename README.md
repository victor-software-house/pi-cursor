# pi-cursor-inference

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
  <img src="docs/banner.svg" alt="pi-cursor — /cursor in Pi · unofficial routed Cursor inference">
</picture>

This package implements Cursor as an unofficial plain inference provider for
[Pi](https://github.com/earendil-works/pi-mono) over
`aiserver.v1.InferenceService/RunInference`. Cursor supplies inference while Pi owns the complete
conversation, arbitrary tool schemas, tool execution, branching, and transcript.

## Install

```sh
pi install npm:pi-cursor-inference
```

Then authenticate and select a Cursor model:

```text
/login cursor
/model
```

To evaluate the extension without adding it to settings:

```sh
pi -e npm:pi-cursor-inference
```

Pi packages execute with full local access. Review this repository before installation. The
[pre-publication privacy audit](https://github.com/victor-software-house/pi-cursor/blob/main/docs/public-history-audit-2026-09-03.md)
records the complete history review performed before the repository became public.

## Features

- Native Pi OAuth through `/login cursor`, plus `PI_CURSOR_TOKEN` for headless use.
- Dynamic model discovery from `AvailableModels`, `GetUsableModels`, and
  `GetDefaultModelForCli`.
- Catalog-backed context windows, image/thinking capabilities, and distinct Max Mode rows only
  when Cursor advertises a meaningful variant difference.
- Streaming thinking text when the provider supplies it, opaque reasoning signatures, text,
  usage, generic tool-call argument deltas, and tool continuations.
- Final response assembly always preserves routed thinking text when Cursor's final message carries
  only redacted or signature-only reasoning metadata.
- Strict reconciliation defaults on: completed streamed and final tools must match by ID, name, and
  deep-equal arguments before Pi can execute them. It can be disabled explicitly in settings.
- Multi-block reasoning metadata matches only by exact signature or exact text, with an unambiguous
  one-to-one fallback; unmatched metadata stays separate instead of attaching by array index.
- Bare `/cursor` opens an action selector for the usage and settings panes.

## Cursor command

Run `/cursor` in TUI mode to choose between **Usage** and **Settings**. Direct commands remain
available:

- `/cursor usage` — account usage with Summary and Models views;
- `/cursor settings` — strict reconciliation and persisted diagnostics;
- `/cursor help` — command shape.

Outside TUI mode, bare `/cursor` and `/cursor help` print the command shape because no selector can
be hosted.

## Usage pane

Run `/cursor usage` to open the account usage pane. It shows the current plan and reset date,
included and on-demand usage for ordinary plans, or current/previous cumulative spend for
Enterprise plans. When the backend returns a per-model breakdown, **Tab** switches between
**Summary** and **Models**; `r` refreshes and `q`/Esc closes the pane.

The pane uses captured DashboardService calls and renderer-defined units. It does not infer prices
from model tokens or invent values for missing samples. Optional failed calls remain visible as
named misses while available usage still renders. Outside TUI mode, print writes plain text, JSON
emits a custom message event, and RPC uses a notification.

## Configuration

`/cursor settings` persists two toggles in Pi's agent directory:

- **Strict reconciliation** defaults to **on**. When enabled, streamed and final response copies
  must agree structurally; tool IDs, names, and arguments are checked before local execution. When
  disabled, Cursor's final content is accepted without that cross-copy equality check. Local stream
  validity, advertised-tool validation, and final-content parsing remain mandatory.
- **Persist diagnostics** defaults to **off**. When enabled, each assistant message carries a
  `cursor-inference-response` diagnostic in session JSONL. Its reconciliation census is payload-free;
  the same diagnostic can also retain provider metadata, image descriptions, and inference-extra
  side-channel data. The current structural census is about 0.6 kB per assistant message (roughly
  56 kB per 100 turns); provider side channels can make it larger. When disabled, Cursor adds no
  assistant-message diagnostic data.

The thinking-loss fix is not configurable. Empty, signature-only, or redacted final reasoning can
never erase non-empty streamed thinking, even when strict reconciliation is off.

Cursor Max Mode defaults to **off**, matching the IDE's ordinary composer model configuration.
Catalog entries with a distinct Max Mode appear as separate `-max` models and carry Cursor's
captured context parameter automatically. Advanced callers may override the Cursor-specific
`cursorMaxMode` and `cursorContext` sampling parameters per request.

## Verification

`mise run verify` is the deterministic gate. It runs formatting/lint checks, TypeScript checking,
105 unit tests, the minified build, publint, the package whitelist, Node and Bun imports of the
extracted tarball, and Pi's real extension loader. The loader proof requires the packed artifact to
register `/cursor` and exactly one native `cursor` provider. Packed CLI checks also require
`/cursor help` to emit plain text in print mode and a custom message event in JSON mode.

A fresh-account live proof on 2026-09-03 established:

- all three catalog surfaces decode and produce selectable models;
- DashboardService usage loads without exposing account values in test output;
- Composer 2.5 returns text through the production RunInference transport;
- the isolated Pi TUI renders both Summary and Models, switches with Tab, closes with `q`, and
  displays optional aggregate timeouts as named partial misses.
- every live inference result explicitly enables and validates the payload-free
  text/reasoning/tool reconciliation census inside its diagnostic;
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

See the
[implementation and verification record](https://github.com/victor-software-house/pi-cursor/blob/main/docs/plan.md)
and [protocol and scope decisions](https://github.com/victor-software-house/pi-cursor/blob/main/docs/decisions.md).
