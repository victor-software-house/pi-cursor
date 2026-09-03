# pi-cursor-inference

> ▲ **Private proof of concept, resumed 2026-09-02.** The repository is private. No functional npm
> release exists; `0.0.0` remains a blank name reservation.

`pi-cursor-inference@0.0.0` is a blank public placeholder that reserves the npm name. It does not
register a provider. Do not install it expecting Cursor inference support.

This private repository implements Cursor as a plain inference provider for
[Pi](https://github.com/badlogic/pi-mono), using
`aiserver.v1.InferenceService/RunInference`. Development has resumed with native OAuth login and
dynamic model discovery; release automation stays disabled pending an explicit operator decision.

## Configuration

Cursor Max Mode defaults to **off**, matching the IDE's ordinary composer model configuration.
Set the Cursor-specific model/request sampling parameter `cursorMaxMode` to `true` to enable it.
The flag participates in Cursor's variant resolution and is sent as
`InferenceRequestedModel.max_mode`; Cursor returns the concrete resolved variant in `runReady` and
`responseInfo`.

## Usage pane

Run `/cursor` or `/cursor usage` to open the account usage pane. It shows the current plan and
reset date, included and on-demand usage for ordinary plans, or current/previous cumulative spend
for Enterprise plans. When the backend returns a per-model breakdown, **Tab** switches between
**Summary** and **Models**; `r` refreshes and `q`/Esc closes the pane.

The pane reproduces Cursor's captured DashboardService calls and renderer-defined units. It does
not infer prices from model tokens or invent values for missing samples. In print and JSON modes,
`/cursor usage` emits the same information as plain text instead of requiring a TUI.

## Preserved scope

- Native Pi provider and Cursor browser login flow.
- Cursor supplies inference; Pi owns context, tools, execution, and transcript.
- Streaming thinking, text, usage, tool-call arguments, and tool continuations.
- Single-account `/cursor` usage pane with Summary and Models views.
- No `AgentService/Run`, Cursor-native tools, MCP projection, or agent bridge.

The implementation plan and evidence boundaries are retained in
[`docs/plan.md`](docs/plan.md).
