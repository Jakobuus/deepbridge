# Flexprice credits

Without either `FLEXPRICE_API_KEY` or `FLEXPRICE_BASE_URL`, `/credits` reports
`source: "local"` and uses the existing demo counter. Live contact attempts cost
one local credit; cached contact reads are free. Every valid `POST /drafts` costs
one credit, including repeated cached drafts.

Set both variables in the service environment to use Flexprice. The base URL must
include `/v1` (cloud example: `https://us.api.flexprice.io/v1`). The client creates
or resolves a customer with the founder ID as `external_id`, and creates the
metered COUNT feature/event `path_enriched` on the first billed action.

In the Flexprice dashboard, create the metered COUNT feature `path_enriched`
(event name also `path_enriched`) before configuring its price. Give the founder
customer exactly one active prepaid wallet and a subscription whose plan prices
that meter at one credit per event. Fund the wallet there. The app does not create grants, prices, subscriptions,
or top-ups. Without a priced subscription, ingestion alone does not debit credits.

The service reads `real_time_credit_balance` before each attempt. Below one credit
(including zero or negative), drafts and live contact checks return **402** before
work starts. A failed billing request or cached balance returns **503**, never a
local fallback. One uniquely identified usage event is submitted before each
allowed attempt, including an attempt whose generation/provider later fails.
Provider fallback to cached contacts after a live attempt is still metered.

Events are asynchronous. This demo uses one service process and has no durable
reservation/reconciliation ledger: rapid concurrent calls can overspend while
Flexprice processes usage. A 202 means accepted, not settled. Do not treat this as
an atomic production spending limit. Local event history resets on restart.

## Self-host the OSS service

Install Docker Compose and Go, then follow the upstream
[Docker Compose setup](https://github.com/flexprice/flexprice#-setting-up-flexprice-from-source-for-development-and-contributions):

```sh
git clone https://github.com/flexprice/flexprice
cd flexprice
make dev-setup
```

This starts infrastructure, migrations, API, consumer, and worker. Configure your
self-hosted dashboard/API key and the wallet/subscription above. For DeepBridge:

```sh
export FLEXPRICE_BASE_URL=http://localhost:8080/v1
export FLEXPRICE_API_KEY='<self-hosted secret key>'
cd service
uv run uvicorn app.main:app --port 8000
```

API shapes and freshness rules: [upstream OpenAPI](https://github.com/flexprice/flexprice/blob/main/docs/swagger/swagger.json).
