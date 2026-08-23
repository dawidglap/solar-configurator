This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Server-side signature emails

Offer acceptance and Vollmacht submission emails are sent by the backend through the existing
`send-signature-email` Edge Function. Configure either:

```bash
SIGNATURE_EMAIL_FUNCTION_URL=https://PROJECT.supabase.co/functions/v1/send-signature-email
SIGNATURE_EMAIL_FUNCTION_TOKEN=SERVER_SIDE_FUNCTION_TOKEN
```

or `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`. The backend sends customer and seller
recipients, seller Reply-To, the public download URL and the generated PDF as a base64 attachment.
Delivery is idempotent per company/order/type and failed deliveries are retried by the existing
`/api/cron/signatures-expire` cron job.

## Realtime events (SSE)

Authenticated CRM clients receive company-scoped events from `GET /api/events/stream`. The
endpoint uses the existing `session` cookie, sends a keep-alive every 25 seconds and limits each
user to five concurrent streams.

For deployments with more than one application instance, configure Redis for cross-instance
fan-out:

```bash
REDIS_URL=redis://USER:PASSWORD@HOST:6379
```

An optional signed webhook can receive the same event payload:

```bash
COMPANY_WEBHOOK_URL=https://example.ch/helionic-events
COMPANY_WEBHOOK_SECRET=SHARED_HMAC_SECRET
```

The signature is sent as `X-Helionic-Signature: sha256=<hex digest>`. A configured webhook URL is
not called without a secret.

The reverse proxy must disable response buffering for the SSE path:

```nginx
location = /api/events/stream {
    proxy_pass http://planner_upstream;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    gzip off;
}
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Manual Subscription Management API

The backend now supports manual subscription management for platform super admins.

### New endpoints

- `GET /api/admin/companies`
- `POST /api/admin/companies`
- `GET /api/admin/companies/:id`
- `PATCH /api/admin/companies/:id/subscription`
- `DELETE /api/admin/companies/:id`
- `GET /api/admin/metrics`
- `POST /api/cron/subscription-status`

### Curl examples

List companies:

```bash
curl 'https://planner.helionic.ch/api/admin/companies' \
  -H 'Origin: https://app.helionic.ch' \
  --cookie 'session=YOUR_SESSION_COOKIE'
```

Create a company:

```bash
curl 'https://planner.helionic.ch/api/admin/companies' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://app.helionic.ch' \
  --cookie 'session=YOUR_SESSION_COOKIE' \
  -d '{
    "name": "Neue Firma AG",
    "ownerEmail": "owner@neuefirma.ch",
    "ownerFirstName": "Max",
    "ownerLastName": "Muster",
    "plan": "professional",
    "validUntil": "2027-05-10T00:00:00.000Z",
    "maxUsers": 20,
    "notes": "Manuell angelegt"
  }'
```

Patch subscription:

```bash
curl 'https://planner.helionic.ch/api/admin/companies/COMPANY_ID/subscription' \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://app.helionic.ch' \
  --cookie 'session=YOUR_SESSION_COOKIE' \
  -d '{
    "plan": "business",
    "validUntil": "2027-12-31T00:00:00.000Z",
    "maxUsers": 50
  }'
```

Run subscription status cron:

```bash
curl 'https://planner.helionic.ch/api/cron/subscription-status' \
  -X POST \
  -H 'x-cron-secret: YOUR_CRON_SECRET'
```

### Migration

Backfill existing companies with subscription defaults:

```bash
npm run backfill:company-subscriptions
```

## Execution Tasks API

The backend now supports a dual-track execution model for won projects:

- `track: montage`
- `track: elektro`

Each project can have one execution task per track, with hard-coded stages:

- `offen`
- `geplant`
- `in_ausfuehrung`
- `abgeschlossen`

The project checklist remains the single source of truth on the linked planning.

### New endpoints

- `GET /api/execution-tasks?track=montage|elektro&stage=&from=&to=&q=&assignee=`
- `GET /api/execution-tasks/:taskId`
- `PATCH /api/execution-tasks/:taskId`
- `POST /api/execution-tasks/backfill`
- `GET /api/execution-tasks/:taskId/checklist`
- `PATCH /api/execution-tasks/:taskId/checklist/:itemKey`

### Notes

- execution tasks are created automatically when a planning moves to `commercial.stage = "gewonnen"`
- creation is idempotent per `(companyId, projectId, track)`
- old `montages` remains untouched and is considered deprecated
- users can carry `executionRoles: ["montage" | "elektro"]`
- `GET /api/users?executionRole=montage|elektro` filters assignable users

### Curl examples

List all montage tasks:

```bash
curl 'https://planner.helionic.ch/api/execution-tasks?track=montage' \
  -H 'Origin: https://app.helionic.ch' \
  --cookie 'session=YOUR_SESSION_COOKIE'
```

Update one execution task:

```bash
curl 'https://planner.helionic.ch/api/execution-tasks/TASK_ID' \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://app.helionic.ch' \
  --cookie 'session=YOUR_SESSION_COOKIE' \
  -d '{
    "stage": "geplant",
    "scheduledStart": "2026-05-20T07:00:00.000Z",
    "scheduledEnd": "2026-05-20T16:00:00.000Z",
    "startTime": "07:00",
    "endTime": "16:00",
    "assignedUserIds": ["USER_ID"],
    "notes": "Termin mit Kunde abgestimmt"
  }'
```

Backfill missing execution tasks for already won projects:

```bash
curl 'https://planner.helionic.ch/api/execution-tasks/backfill' \
  -X POST \
  -H 'Origin: https://app.helionic.ch' \
  --cookie 'session=YOUR_SESSION_COOKIE'
```

### Scripts

```bash
npm run backfill:execution-tasks
npm run migrate:montages-to-execution-tasks
npm run test:execution-tasks
```

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
