# SignalDesk

SignalDesk is a private, mobile-first editorial tool for drafting short
AI-news Signals from source links and editor notes. It supports a review step
before anything is sent onward.

## Build

Use Node.js `>=22.13.0`.

```bash
npm run build
```

## Runtime Note

`PUBLIC_APP_URL` is optional but recommended. When set, SignalDesk uses it as
the Referer for backend WordPress REST requests.

## Troubleshooting

- HTML returned instead of JSON: confirm the frontend is calling `/api/publish`
  with `POST`, not a page URL. The error message should include the HTTP status
  and a short response preview.
- Wrong API route: rebuild and confirm the deployment includes the `/api/publish`
  function route.
- WordPress REST blocked: check that the configured WordPress posts REST URL
  returns JSON. HTML usually means a security layer, login page, 404, or wrong
  base URL is intercepting the request.
- Invalid WordPress application password: regenerate the dedicated app password
  and make sure the publishing user has permission to create posts and terms.
- Missing runtime configuration: verify the hosted environment has the required
  OpenAI, WordPress, and app auth values configured.
- Wordfence blank User-Agent/Referer block: set `PUBLIC_APP_URL` in production
  so backend WordPress requests carry the expected Referer.
- Production diagnostics: call `/api/diagnostics` from an authenticated session
  to check runtime configuration presence and WordPress REST JSON reachability.
