# Marketing-site tests

The canonical acquisition pages have two local test layers:

```bash
npm test
npm run test:browser
```

`npm test` verifies that `/waitlist/` and `/start/` are generated from the same
template, differ only where intended, and preserve the opaque attribution
handoff contract.

`npm run test:browser` serves the checked-in site from an ephemeral
`127.0.0.1` port and exercises both Chromium and WebKit at:

- 320 × 568
- 375 × 667
- 393 × 852
- 430 × 932

The browser suite covers both acquisition routes, CTA labels and reachability,
horizontal overflow, canonical/indexing metadata, and its own network barrier.
Every request outside the exact ephemeral loopback origin is aborted before it
can reach analytics, Supabase, Turnstile, Meta, or any other provider. The suite
does not create prospects, handoffs, accounts, subscriptions, or production
events.

Install the two local browser engines once:

```bash
npm run test:browser:install
```

Run both layers together with:

```bash
npm run test:all
```

No GitHub Actions runner is required; these commands are intentionally local.
