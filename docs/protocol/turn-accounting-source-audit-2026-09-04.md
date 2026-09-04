# Cursor turn-accounting source audit

Date: 2026-09-04 BRT

## Result

The earlier turn-accounting description was incomplete. Cursor IDE 3.18.9 contains a
DashboardService event endpoint with fine-grained token and monetary fields. The Admin API is not
the only Cursor surface that exposes event-level cost.

This does not give the current provider an exact settled cost for each Pi assistant message.
RunInference still reports tokens without money, and the event rows expose `conversation_id` but not
RunInference's per-call `invocation_id`.

## Evidence method

The exact artifact in
[`inference-service-3.18.9/artifact-lock.json`](inference-service-3.18.9/artifact-lock.json) was
downloaded again and matched the pinned `270656436`-byte SHA-256
`dc43417a2c44f7221fb764f329d9b7edf819253ee01c8bc9abb562ae020270e4`. The extracted `main.js`,
`657.js`, and `675.js` also matched their recorded hashes. This audit additionally pins `268.js`.

The relevant webpack module factories were extracted without executing the module bodies and
formatted with Prettier 3.6.2 using `--no-config`. Searches covered token, cost, price, billing,
charge, conversation, request, and invocation fields across the matching modules. A source-drift
check against Cursor IDE 3.18.25 found the same event/correlation field set.

## RunInference

Pinned module `657.js:8844` defines the complete selected response contract:

- `InferenceUsageInfo`: `prompt_tokens`, `completion_tokens`, optional `total_tokens`;
- `InferenceExtendedUsageInfo`: `input_tokens`, `output_tokens`, `cache_read_tokens`,
  `cache_write_tokens`, and `max_tokens`;
- `InferenceInvocationIdInfo`: `invocation_id`;
- `InferenceProviderMetadataInfo`: an untyped protobuf `Struct`;
- `InferenceResponseInfo`: response ID, model, creation timestamp, final messages, error, and
  inference-extra data.

No typed RunInference response message has a price, cents, charge, billing, or cost field. The
`provider_metadata` arm can carry arbitrary keys, so the schema alone cannot prove that a future
server will never place cost there. The formatted client treats it as an opaque object and contains
no logic that reads a billed-cost key from it. Module `675.js:40675` maps the usage and
extended-usage arms directly to their token values, resolves the invocation ID separately, and does
not calculate or recover money from the stream.

The same module shows the correlation boundary. The outer `RunInferenceRunRequest` carries one
`conversationId`; every nested `RunInferenceInvokeModel` carries its own `invocationId`. `pi-cursor`
uses the stable Pi session ID for the former and a UUID for each inference call, matching this
run/invocation separation.

## DashboardService event costs

The formatted pinned source contains a finer-grained DashboardService contract that the current
`/cursor usage` implementation does not call:

- `657.js:75335` registers `GetFilteredUsageEvents` and `GetAggregatedUsageEvents`.
- `268.js:36006` defines the paginated `GetFilteredUsageEvents` request and response. Filters include
  team, user, model, time range, service account, cloud agent, automation, and client type.
- `268.js:5576` defines each `UsageEventDisplay` with timestamp, model, Max Mode, usage kind,
  token-based status, `TokenUsage`, Cursor Token fee, chargeability, `charged_cents`, client type,
  and optional `conversation_id`.
- `TokenUsage` contains input, output, cache-write, and cache-read tokens plus `total_cents` and
  discount fields.

The event schema has no `invocation_id`, request ID, generation ID, or response ID. The response's
raw `UsageEvent` also has no invocation field. Cursor IDE 3.18.25 retains this exact limitation.

The current implementation selects only `GetAggregatedUsageEvents`, which returns account/time-window
and per-model totals. The source proves that finer event rows exist; it does not prove that every
account role can call the filtered endpoint. No Team OAuth live call was made during this audit.

## Official external surfaces

Cursor's official
[Admin API usage-events endpoint](https://cursor.com/docs/account/teams/admin-api#get-usage-events-data)
exposes a closely matching event shape through separate Team Admin API-key authentication. Its
documented rows include model, token counts, model cost, actual charged cost, Cursor Token fee,
timestamp, and optional conversation ID. The documented data is aggregated hourly and likewise has
no RunInference invocation ID.

Cursor's [Agent SDK](https://cursor.com/docs/sdk/python) exposes eventual usage and billed cost for
Cursor-managed local turns or cloud runs. That cost belongs to Cursor's agent runtime, which this
package deliberately does not use.

## Provider consequence

`pi-cursor` can report exact RunInference token counts immediately on each Pi assistant message. It
cannot report exact settled billed cost there from the currently selected response contract.

A later reconciliation feature could query filtered usage events and match on session conversation
ID, model, timestamp, and the token tuple. Such a match may be unique in ordinary data, but it is not
an identifier-level join and can be ambiguous. It would also arrive after the inference response and
may vary by account permissions and billing settlement. It must not be represented as exact
per-response cost without a stronger correlation key.
