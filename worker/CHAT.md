# Splash website chat responder

This is the existing `jupwash-api` Worker (`worker/index.js`). It is not a second service. The public website stays on Cloudflare Pages. This document is for review before any deploy.

The chat answers a visitor inside the website widget at any hour. It does not send SMS, email, or any other outbound message. Lead emails from the contact form are unchanged.

## What visitors get

- Approved offers only: power washing $300 half day / $550 full day, solar $995 or $1,795/year, exterior car wash $25 or $99/month unlimited, soap dishes as a question with no price.
- Shop phone hours stay Monday–Saturday 8am–6pm, closed Sunday. Those hours were already public. The chat itself still answers outside them and must not say the shop is open then.
- The chat cannot book a job. A model reply that claims a booking or an unlisted price is replaced. The replacement says nothing is booked and gives 561-600-9274 and wash@jupiterpowerwash.com.
- If Workers AI times out (12 seconds) or errors, the visitor gets that same style of fallback. The HTTP status is still 200 so the widget can show it.

## Stored data

Binding: existing D1 `TOKENS_DB` (`database_name = "jupwash-tokens"`). No new D1 database and no KV namespace.

Tables from `worker/migrations/0001_chat_review.sql`:

- `chat_conversations`: id, timestamps, status (`answered`, `unanswered`, `escalated`, `open`), message count, optional escalated reason.
- `chat_messages`: visitor or assistant text, timestamp, outcome (`ok`, `fallback`, `escalated`).

No IP address, no secrets, and no contact-form photos are stored. Message text is capped at 1,000 characters. The worker deletes conversation and message rows whose time is older than 30 days whenever a later chat is saved.

Status:

- `answered` — the model reply was shown.
- `unanswered` — the visitor only received the trouble fallback.
- `escalated` — the visitor asked for a person, a manager, a call, a complaint, or a refund. The chat still replies in the widget only.

If D1 is down, the visitor still gets an answer and nothing from that turn is stored. The log line is `chat store error` with no message text.

## Endpoints

| Method | Path | Who |
| --- | --- | --- |
| `POST` | `/api/chat` | Website only. `Origin` must be `https://jupiterpowerwash.com`, `https://www.jupiterpowerwash.com`, `https://jupwash.pages.dev`, or `https://<preview>.jupwash.pages.dev`. Body: `{ "message": "...", "conversationId": "<uuid>" }`. Client history is ignored. |
| `GET` | `/api/health` | Public. `{"ok":true,"service":"splash"}` or `{"ok":false,"service":"splash","degraded":["ai"]}` / `"store"`. No tokens, emails, or ids. |
| `GET` | `/api/chat/review` | Authenticated read only. Missing or wrong credentials get 401 and no messages. |

There is no public list of conversations.

## Read-only monitoring

Set the secret on the existing worker (this does not send mail):

```bash
cd worker
npx wrangler secret put CHAT_REVIEW_TOKEN
```

Then:

```bash
curl -sS -H "Authorization: Bearer $CHAT_REVIEW_TOKEN" \
  "https://jupwash-api.dm-6ab.workers.dev/api/chat/review?status=escalated&limit=20"

curl -sS -H "Authorization: Bearer $CHAT_REVIEW_TOKEN" \
  "https://jupwash-api.dm-6ab.workers.dev/api/chat/review?status=unanswered&limit=20"
```

`status` may be `answered`, `unanswered`, `escalated`, or `open`. Omit it to list the newest conversations. `limit` is at most 20. Each item includes at most 30 messages.

Health, no credentials:

```bash
curl -sS https://jupwash-api.dm-6ab.workers.dev/api/health
```

## Deploy, after review

Do not deploy until that review is done. Wrangler must already be logged in. From `worker/`:

```bash
npx wrangler d1 execute jupwash-tokens --remote --file=migrations/0001_chat_review.sql
npx wrangler secret put CHAT_REVIEW_TOKEN
npx wrangler deploy
```

`wrangler deploy` publishes the existing Worker named `jupwash-api`. It does not publish the Pages site. Pages does not run this Worker.

Rate limit stays the existing `CHAT_IP` binding: 20 messages per visitor IP per minute.
