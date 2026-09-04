# Cursor turn-accounting source audit

Date: 2026-09-04 BRT

## Result

The earlier turn-accounting description was incomplete. Cursor IDE 3.18.9 contains three additional
cost-bearing contracts outside RunInference:

- `DashboardService.GetFilteredUsageEvents` returns event rows with token, model-cost, and
  charged-cost fields;
- `DashboardService.GetClientUsageData` accepts a conversation ID and a timestamp boundary, then
  returns named costs in cents;
- `AiService.CheckUsageBasedPrice` returns a quoted price for supplied feature details.

The formatted client proves that `CheckUsageBasedPrice` is a preflight display, not measured usage.
It contains no conversation or invocation identifier. `GetClientUsageData` is present in generated
schema and service descriptors but has no caller anywhere in the packaged 3.18.9 desktop workbench
or agent-host JavaScript. Its name and wire fields are evidence of a conversation/time-bounded cost
query; without a client caller or server implementation, they do not establish its timestamp unit,
settlement timing, returned item meanings, or whether concurrent requests can be separated.

This still does not give the current provider an exact settled cost for each Pi assistant message.
RunInference reports tokens without money. None of the three monetary contracts accepts or returns
RunInference's per-call `invocation_id`.

## Evidence method

The exact artifact in
[`inference-service-3.18.9/artifact-lock.json`](inference-service-3.18.9/artifact-lock.json) was
downloaded again and matched the pinned `270656436`-byte SHA-256
`dc43417a2c44f7221fb764f329d9b7edf819253ee01c8bc9abb562ae020270e4`. The extracted agent-host
`main.js`, `268.js`, `657.js`, and `675.js` and the desktop `workbench.desktop.main.js` are pinned by
byte count and SHA-256.

Relevant webpack module factories were extracted without executing their bodies and formatted with
Prettier 3.6.2 using `--no-config`. The audit then:

1. enumerated protobuf type fields matching cost, price, charge, billing, spend, fee, or cents;
2. inspected every inference/usage hit and its complete message definition;
3. searched the full packaged workbench and agent-host JavaScript for each service method and
   camelCase/snake_case request and response field;
4. classified actual callers separately from generated schemas and service descriptors.

A source-drift check against Cursor IDE 3.18.25 found the same contracts and the same absence of a
`GetClientUsageData` caller. That later client also uses `CheckUsageBasedPrice` only for the
usage-based-pricing preflight display.

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
raw `UsageEvent` has price data but no invocation field. Full-workbench symbol search finds only the
generated filtered-method descriptor; the packaged desktop client does not call it. Cursor IDE
3.18.25 retains this field set and absence of a caller.

The current implementation selects only `GetAggregatedUsageEvents`, which returns account/time-window
and per-model totals. The source proves that finer event rows exist; it does not prove that every
account role can call the filtered endpoint. No Team OAuth live call was made during this audit.

## Conversation/time-bounded client usage

`268.js:36006` also defines `GetClientUsageData`:

- request: `conversation_id` and int32 `timestamp_before_request`;
- response: repeated `items_with_cost`;
- item: `name` and int32 `cost_in_cents`.

`657.js:75335` registers the unary DashboardService method. Exhaustive exact-symbol searches of the
full 3.18.9 desktop workbench, Glass workbench, and agent-host JavaScript find only this schema and
service descriptor. There is no bundled call, no construction of its request fields, and no
consumption of its response fields. The 3.18.25 desktop workbench has the same result.

The wire shape is consistent with a cost query bounded by conversation and a pre-request timestamp,
but formatted source does not establish more. In particular, the int32 field's unit, the names of
returned items, billing settlement behavior, and handling of overlapping requests are absent. The
method has no `invocation_id`, so its contract is not an identifier-level join to a RunInference
call. It is a candidate for future measured investigation, not evidence that exact per-response cost
is currently available.

## Usage-based price preflight

Pinned module `657.js:58072` defines `CheckUsageBasedPriceRequest` with one
`UsageEventDetails` value and a response containing `markdown_response`, `cents`, and `price_id`.
`UsageEventDetails` describes a proposed feature/model/token shape; the request has no conversation,
invocation, request, response, or generation identifier.

The 3.18.9 desktop and Glass workbench variants each contain the same single caller. The
usage-based-pricing modal submits the supplied feature details, then renders `markdownResponse`
before the operator enables usage-based pricing.
It does not associate the response with a completed inference and does not consume `cents` as
settled usage. This contract is a quote/preflight surface, not a post-response cost measurement.

## Other cost-field census results

The remaining formatted protobuf hits do not expose measured RunInference cost:

- `AvailableModelsResponse.AvailableModel.price` and model-parameter
  `increases_model_cost` flags are catalog metadata. They carry no request, conversation, or
  invocation identifier and are not response accounting.
- `CheckBugBotPriceResponse`, `BugBotStatus`, and `UsageEventDetails.BugFinderTriggerV1.cost_cents`
  belong to BugBot/Bug Finder features, not `InferenceService.RunInference`.
- current-period usage, grants, invoices, hard limits, team spend, service-account spend, and daily
  spend messages are account or policy aggregates.
- higher-level native chat/agent schemas contain `usage_uuid` on some response/message shapes, but
  the selected RunInference schema does not. The formatted source contains no mapping from such a
  UUID to `UsageEventDisplay` or `GetClientUsageData`.

These classes were retained in the census rather than treated as RunInference cost paths.

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

A later reconciliation feature could investigate `GetClientUsageData` and query filtered usage
events. Filtered rows can be matched on session conversation ID, model, timestamp, and token tuple;
`GetClientUsageData` offers a conversation/time boundary but no per-call identifier. Either approach
may isolate a value in ordinary sequential use, but the pinned source does not prove exact
per-response attribution under concurrency or establish when billing settles. Neither may be
represented as exact per-response cost without measured semantics and a stronger correlation rule.
