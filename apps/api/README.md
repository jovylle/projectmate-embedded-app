# @projectmate/api

Cloudflare Worker API for moderated issues:

- `POST /issues` create a new issue with optional screenshot upload to R2
- `GET /issues?projectId=:id&view=open|resolved` public issue lists
- `GET /issues/moderation?projectId=:id` admin moderation queue
- `PATCH /issues/:id/status` admin status transitions (`approved_open`, `resolved`, `rejected`)
- `GET /issues/:id/screenshot` screenshot asset stream

## Local setup

1. Create D1 and R2 resources in your Cloudflare account.
2. Update `wrangler.toml` with your D1 `database_id` and R2 bucket name.
3. Apply DB migrations:

```bash
pnpm --filter @projectmate/api d1:migrate
```

4. Start the worker locally:

```bash
pnpm --filter @projectmate/api dev
```

## Admin authorization

Moderation endpoints require one of:

- `x-projectmate-admin: true`, or
- `x-projectmate-role: admin`

Optionally set `ADMIN_API_KEY` in worker secrets to require `Authorization: Bearer <token>` on top of the admin header.
