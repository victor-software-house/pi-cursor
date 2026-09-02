# pi-cursor-inference

Cursor as a plain inference provider for [Pi](https://github.com/badlogic/pi-mono), over
`aiserver.v1.InferenceService/RunInference`.

> ▲ `0.0.0` only reserves the npm name. It does not register a provider yet. The first functional
> release will be `0.0.1`.

## Intended contract

- Native Pi provider and `/login cursor` flow.
- Cursor supplies inference; Pi owns context, tools, execution, and transcript.
- Streaming thinking, text, usage, tool-call arguments, and tool continuations.
- No `AgentService/Run`, Cursor-native tools, MCP projection, or agent bridge.

See [the implementation plan](docs/plan.md) in the repository for the evidence and verification
contract.
