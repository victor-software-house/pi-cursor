# pi-cursor-inference

> ▲ **Stopped proof of concept.** This repository remains private. No functional npm release is
> planned.

`pi-cursor-inference@0.0.0` is a blank public placeholder that reserves the npm name. It does not
register a provider. Do not install it expecting Cursor inference support.

The private repository retains an unreleased implementation of Cursor as a plain inference provider
for [Pi](https://github.com/badlogic/pi-mono), using
`aiserver.v1.InferenceService/RunInference`. The implementation is preserved as research and is not
supported, published, or ready for use.

## Preserved scope

- Native Pi provider and Cursor browser login flow.
- Cursor supplies inference; Pi owns context, tools, execution, and transcript.
- Streaming thinking, text, usage, tool-call arguments, and tool continuations.
- No `AgentService/Run`, Cursor-native tools, MCP projection, or agent bridge.

The historical implementation plan and evidence boundaries are retained in
[`docs/plan.md`](docs/plan.md). They are not an active release roadmap.
