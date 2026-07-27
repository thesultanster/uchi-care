import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  allowlistedAttribution,
  beginWebOnboarding,
} from '../../assets/waitlist-core.mjs';
import {
  DEFAULT_START_LANDING_VARIANT,
  resolveStartLandingVariant,
} from '../../assets/landing-variants.mjs';
import {
  ACQUISITION_VARIANTS,
  renderAcquisitionPage,
} from '../generate-acquisition-pages.mjs';

const template = readFileSync(
  new URL('../templates/acquisition-page.html', import.meta.url),
  'utf8',
);
const waitlistHtml = readFileSync(
  new URL('../../waitlist/index.html', import.meta.url),
  'utf8',
);
const startHtml = readFileSync(
  new URL('../../start/index.html', import.meta.url),
  'utf8',
);
const waitlistScript = readFileSync(
  new URL('../../assets/waitlist.js', import.meta.url),
  'utf8',
);
const waitlistCss = readFileSync(
  new URL('../../assets/waitlist.css', import.meta.url),
  'utf8',
);

function normalizeVariantMarkup(html) {
  return html
    .replace('    <meta name="robots" content="noindex, nofollow">\n', '')
    .replaceAll(
      /https:\/\/uchi\.care\/(?:waitlist|start)\//g,
      '{{CANONICAL_URL}}',
    )
    .replace(
      /content="(?:0x[A-Za-z0-9_-]+)?">(?=\n    <link rel="icon")/,
      'content="{{TURNSTILE_SITE_KEY}}">',
    )
    .replace(
      /data-landing-variant="[^"]+"/,
      'data-landing-variant="{{LANDING_VARIANT}}"',
    )
    .replace(
      /data-acquisition-mode="[^"]+"/,
      'data-acquisition-mode="{{ACQUISITION_MODE}}"',
    )
    .replace(
      /(<form class="waitlist-card" id="waitlist-form"[\s\S]*?<button[^>]*data-landing-copy="primaryCta"[^>]*>)[^<]+(<\/button>)/,
      '$1{{PRIMARY_CTA}}$2',
    )
    .replace(
      /(<form class="waitlist-card" id="waitlist-form-secondary"[\s\S]*?<button[^>]*data-landing-copy="secondaryCta"[^>]*>)[^<]+(<\/button>)/,
      '$1{{SECONDARY_CTA}}$2',
    );
}

test('generates both production pages from the rich acquisition template', () => {
  assert.equal(renderAcquisitionPage(template, 'waitlist'), waitlistHtml);
  assert.equal(renderAcquisitionPage(template, 'start'), startHtml);
  assert.equal(
    ACQUISITION_VARIANTS.waitlist.outputPath,
    'waitlist/index.html',
  );
  assert.equal(ACQUISITION_VARIANTS.start.outputPath, 'start/index.html');
});

test('keeps the visible page identical except for the two CTA labels', () => {
  assert.equal(normalizeVariantMarkup(startHtml), normalizeVariantMarkup(waitlistHtml));
  assert.match(waitlistHtml, />Join the waitlist →<\/button>/);
  assert.match(waitlistHtml, />Join the waitlist ↑<\/button>/);
  assert.match(startHtml, />Get started →<\/button>/);
  assert.match(startHtml, />Get started ↑<\/button>/);
});

test('keeps early access metadata and behavior distinct from the waitlist', () => {
  assert.match(startHtml, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(startHtml, /<link rel="canonical" href="https:\/\/uchi\.care\/start\/">/);
  assert.match(startHtml, /data-acquisition-mode="web-onboarding"/);
  assert.match(
    startHtml,
    /data-landing-variant="manga-couples-activation-v1"/,
  );
  assert.match(waitlistHtml, /data-acquisition-mode="waitlist"/);
  assert.doesNotMatch(waitlistHtml, /<meta name="robots"/);
  assert.match(
    waitlistHtml,
    /<meta name="turnstile-site-key" content="0x4AAAAAAD-jFTnrv9lm3glJ">/,
  );
  assert.match(waitlistScript, /if \(IS_WEB_ONBOARDING\) \{/);
  assert.match(waitlistScript, /getAcquisitionCaptchaToken/);
  assert.match(waitlistScript, /captchaToken,/);
  assert.match(
    waitlistScript,
    /navigate: \(destination\) => window\.location\.assign\(destination\)/,
  );
  assert.match(waitlistScript, /await beginWebOnboarding\(/);
  assert.match(waitlistScript, /resolveStartLandingVariant\(search/);
  assert.match(
    waitlistScript,
    /sticky_chores_viewed:\$\{window\.location\.pathname\}:\$\{LANDING_VARIANT\}/,
  );
  assert.match(
    waitlistScript,
    /sticky_chores_frame_animation:\$\{window\.location\.pathname\}:\$\{LANDING_VARIANT\}:\$\{FRAME_ANIMATION_ID\}/,
  );
});

test('selects only configured start variants and safely falls back', () => {
  const explicit = resolveStartLandingVariant(
    new URLSearchParams(
      `landing_variant=${DEFAULT_START_LANDING_VARIANT}`,
    ),
  );
  assert.equal(explicit.variant.id, DEFAULT_START_LANDING_VARIANT);
  assert.equal(explicit.source, 'query');
  assert.equal(explicit.fellBack, false);

  const legacy = resolveStartLandingVariant(
    new URLSearchParams(
      'landing_variant=manga-couples-coop-v3-web-onboarding',
    ),
  );
  assert.equal(legacy.variant.id, DEFAULT_START_LANDING_VARIANT);
  assert.equal(legacy.source, 'query');
  assert.equal(legacy.fellBack, false);

  const unknown = resolveStartLandingVariant(
    new URLSearchParams('landing_variant=unpublished-ad-promise'),
  );
  assert.equal(unknown.variant.id, DEFAULT_START_LANDING_VARIANT);
  assert.equal(unknown.source, 'default');
  assert.equal(unknown.fellBack, true);
});

test('passes only allowlisted attribution and an opaque handoff to the product', async () => {
  const requests = [];
  const navigations = [];
  const handoffToken = 'A'.repeat(43);

  await beginWebOnboarding({
    request: async (path, payload) => {
      requests.push({ path, payload });
      return { ok: true, handoffToken };
    },
    navigate: (destination) => navigations.push(destination),
    email: '  COUPLE@Example.com ',
    sessionId: 'c90bd920-d269-4ce7-8960-bcf0605b9d57',
    attribution: {
      source: 'meta',
      medium: 'paid_social',
      campaign: 'early-access',
      adId: '42',
      email: 'must-not-cross@example.com',
      arbitrary: 'must-not-cross',
    },
    landingVariant: 'manga-couples-coop-v3-web-onboarding',
    pagePath: '/start/',
    captchaToken: 'turnstile-token',
  });

  assert.deepEqual(requests, [
    {
      path: 'create-web-onboarding-handoff',
      payload: {
        email: 'couple@example.com',
        sessionId: 'c90bd920-d269-4ce7-8960-bcf0605b9d57',
        attribution: {
          source: 'meta',
          medium: 'paid_social',
          campaign: 'early-access',
          adId: '42',
        },
        landingVariant: 'manga-couples-coop-v3-web-onboarding',
        pagePath: '/start/',
        captchaToken: 'turnstile-token',
        company: '',
      },
    },
  ]);

  const destination = new URL(navigations[0]);
  assert.equal(destination.origin, 'https://stickychores.app');
  assert.equal(destination.pathname, '/start');
  assert.equal(destination.search, '');
  assert.equal(
    new URLSearchParams(destination.hash.slice(1)).get('handoff'),
    handoffToken,
  );
  assert.equal(navigations[0].includes('couple%40example.com'), false);
});

test('sanitizes attribution restored from browser storage', () => {
  assert.deepEqual(
    allowlistedAttribution({
      source: ' meta ',
      campaignId: '123',
      email: 'private@example.com',
      painPoint: 'private answer',
    }),
    { source: 'meta', campaignId: '123' },
  );
  assert.match(
    waitlistScript,
    /attribution = allowlistedAttribution\(JSON\.parse\(storedAttribution\)\)/,
  );
});

test('keeps a Turnstile interaction reachable to assistive technology', () => {
  assert.match(startHtml, /<div id="web-onboarding-turnstile"><\/div>/);
  assert.doesNotMatch(startHtml, /id="web-onboarding-turnstile" aria-hidden/);
});

test('compresses the hero art on short phones without removing it', () => {
  assert.match(
    waitlistCss,
    /@media \(max-width: 680px\) and \(max-height: 700px\)/,
  );
  assert.match(
    waitlistCss,
    /\.hero-scene-player\s*\{[\s\S]*?height: clamp\(230px, 42vh, 280px\)/,
  );
  assert.match(startHtml, /class="hero-scene-player"/);
});
