# crm-mcp Edge Function

Read-only Model Context Protocol (MCP) server exposing three CRM lookups to Cowork's `new-client` skills:

- `find_clients({ name })` — fuzzy-search for matching accounts (top 5)
- `get_client({ client_id })` — fetch FTE range/count for one account
- `find_client_by_pandadoc({ pandadoc_id })` — resolve a PandaDoc doc → account

Uses the Supabase **service role** key on the server side and a separate **client secret** (`MCP_CLIENT_SECRET`) passed via the `?key=` query parameter for inbound auth. Read-only by design — there are no write tools and the function never accepts raw SQL.

## Deploy

```bash
# 1. Pick a fresh random secret and stash it in 1Password.
RANDOM_SECRET=$(openssl rand -hex 24)
echo "$RANDOM_SECRET"

# 2. Set it on the production project.
supabase secrets set MCP_CLIENT_SECRET="$RANDOM_SECRET" \
  --project-ref igmwomnkbbsytihtvhbp

# 3. Deploy the function.
supabase functions deploy crm-mcp --no-verify-jwt \
  --project-ref igmwomnkbbsytihtvhbp
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Final URL:

```
https://igmwomnkbbsytihtvhbp.functions.supabase.co/crm-mcp
```

## Smoke tests

```bash
BASE=https://igmwomnkbbsytihtvhbp.functions.supabase.co/crm-mcp
SECRET=<the value of MCP_CLIENT_SECRET>

# tools/list — should return all three tools.
curl -sS -X POST "$BASE?key=$SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq

# find_clients — replace with a real client name you know is in the CRM.
curl -sS -X POST "$BASE?key=$SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_clients","arguments":{"name":"Medcurity"}}}' | jq

# get_client — paste a client_id from the previous response.
curl -sS -X POST "$BASE?key=$SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_client","arguments":{"client_id":"<uuid>"}}}' | jq

# Auth failure should return 401.
curl -sS -i -X POST "$BASE?key=wrong-secret" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/list"}'
```

## Sharing with Cowork

Once smoke tests pass, send back:

1. URL: `https://igmwomnkbbsytihtvhbp.functions.supabase.co/crm-mcp`
2. The `MCP_CLIENT_SECRET` value (from 1Password)
3. Confirmation: production, read-only

## Extending later

Add new tools by:
1. Appending to the `TOOLS` array (name + JSON Schema).
2. Adding the implementation function.
3. Adding the `case` in `handleToolCall`.

Stay read-only. Don't add anything that writes, lists everything in a table, or accepts raw SQL.
