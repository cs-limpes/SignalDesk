# News of the AI Signal PWA

Private mobile-first PWA for turning AI-related news articles into short
editorial WordPress posts called Signals.

The app is intentionally narrow: paste a source URL, add the editor observation,
generate an editable Signal, then explicitly save a draft or publish to
WordPress.

## Stack

- Vinext, React, TypeScript
- Cloudflare Workers-compatible runtime
- Cloudflare Sites-compatible `.openai/hosting.json`
- Cloudflare D1 for duplicate source tracking and simple rate limits
- WordPress REST API for taxonomy and posts
- OpenAI Responses API with structured output
- PWA manifest and service worker

## Local Setup

Use Node.js `>=22.13.0`.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Fill `.dev.vars` with real local credentials. Do not commit `.dev.vars`.

The app runs at `http://localhost:3000/` by default. Local requests are allowed
without `AUTH_SHARED_SECRET`; remote deployments require Cloudflare Access,
OpenAI workspace identity headers, or the shared-secret header.

## Required Secrets

Set these as Cloudflare Secrets in production:

- `OPENAI_API_KEY`
- `WP_BASE_URL`
- `WP_USERNAME`
- `WP_APPLICATION_PASSWORD`
- `AUTH_SHARED_SECRET` for the simple shared-secret auth path

Optional:

- `OPENAI_MODEL`, defaults to `gpt-5.5`

For shared-secret auth, enter the same value in the app's Auth token field. The
frontend sends it as `x-signal-auth`; credentials are never committed.

## WordPress Application Password

1. In WordPress Admin, open Users.
2. Open the dedicated publishing user.
3. Find Application Passwords in the user profile.
4. Create a password named `News of the AI Signal`.
5. Store the generated password as `WP_APPLICATION_PASSWORD`.

The user needs permissions to read categories/tags, create tags/categories, and
create posts.

## Cloudflare Deployment

`.openai/hosting.json` declares D1 binding `DB`. The app uses runtime table
initialization for the MVP, and `db/schema.ts` also defines the Drizzle schema.

Before deploying:

```bash
npm run build
```

Then configure production secrets in the hosting control plane:

```bash
OPENAI_API_KEY
OPENAI_MODEL
WP_BASE_URL
WP_USERNAME
WP_APPLICATION_PASSWORD
AUTH_SHARED_SECRET
```

Protect the whole app with Cloudflare Access when possible. The API also accepts
`cf-access-authenticated-user-email` and `oai-authenticated-user-email` headers
as authenticated identities.

## Article Access Rules

Source access status is determined server-side:

- `full`: readable article text was extracted
- `partial`: some article body text was extracted
- `metadata_only`: only title, description, source, or fetch failure data is
  available
- `manual`: the editor supplied a manual summary

If access is `metadata_only` and no manual summary exists, WordPress actions are
blocked. The editor can add a manual summary or use a different URL.

## WordPress Output

Posts include:

- title
- Signal paragraph
- source link
- excerpt
- selected or newly created tags
- selected or deliberately created category
- source URL and source access status as HTML comments

The app attempts to send `source_url` and `source_access_status` as WordPress
meta. If the site rejects unregistered meta fields, it retries without meta and
keeps the source data in post content comments.

## Useful Commands

```bash
npm run dev
npm run build
npm run lint
npm run db:generate
```

## Known Limitations

- Article extraction is heuristic and will not bypass paywalls or heavy
  JavaScript rendering.
- Duplicate tracking is URL-based; syndicated copies on different URLs are not
  treated as duplicates.
- Rate limiting is intentionally simple D1 window counting.
- WordPress custom meta fields must be registered separately if you want them
  queryable through the WordPress REST API.
- Cloudflare Access policy setup is external to this repo.
