# pi-cursor-inference

> ▲ **Private proof of concept, resumed 2026-09-02.** The repository is private. No functional npm
> release exists; `0.0.0` remains a blank name reservation.

`pi-cursor-inference@0.0.0` is a blank public placeholder that reserves the npm name. It does not
register a provider. Do not install it expecting Cursor inference support.

This private repository implements Cursor as a plain inference provider for
[P](https://github.com/badlogic/pi-mono), using
`aiserver.v1.InferenceService/RunInference`. Development has resumed with native OAuth login and
dynamic model discovery; release automation stays disabled pending an explicit operator decision.

## Preserved scope

- Native Pi provider and Cursor browser login flow.
- Cursor supplies inference; Pi owns context, tools, execution, and transcript.
- Streaming thinking, text, usage, tool-call arguments, and tool continuations.
- No `AgentService/Run`, Cursor-native tools, MCP projection, or agent bridge.

The implementation plan and evidence boundaries are retained in
[`docs/plan.md`](docs/plan.md).
