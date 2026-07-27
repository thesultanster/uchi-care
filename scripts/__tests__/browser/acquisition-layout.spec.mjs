import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 320, height: 568 }),
  Object.freeze({ width: 375, height: 667 }),
  Object.freeze({ width: 393, height: 852 }),
  Object.freeze({ width: 430, height: 932 }),
]);

const SURFACES = Object.freeze({
  waitlist: Object.freeze({
    path: '/waitlist/',
    canonical: 'https://uchi.care/waitlist/',
    robots: null,
    ctas: Object.freeze(['Join the waitlist →', 'Join the waitlist ↑']),
  }),
  start: Object.freeze({
    path: '/start/',
    canonical: 'https://uchi.care/start/',
    robots: 'noindex, nofollow',
    ctas: Object.freeze(['Get started →', 'Get started ↑']),
  }),
});

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
});

function createStaticServer() {
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        'cache-control': 'no-store',
        allow: 'GET, HEAD',
      });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      );
    } catch {
      response.writeHead(400, { 'cache-control': 'no-store' });
      response.end();
      return;
    }

    const relativePath = pathname.endsWith('/')
      ? `${pathname.slice(1)}index.html`
      : pathname.slice(1);
    const filePath = resolve(repositoryRoot, relativePath);
    const withinRepository =
      filePath === repositoryRoot ||
      filePath.startsWith(`${repositoryRoot}${sep}`);

    if (
      !withinRepository ||
      !existsSync(filePath) ||
      !statSync(filePath).isFile()
    ) {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type':
        CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  });
}

async function listenOnEphemeralLoopback(server) {
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('The acquisition test server did not bind to loopback.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

async function installNetworkBarrier(page, localOrigin) {
  const blockedExternalRequests = [];
  const completedExternalRequests = [];

  page.on('requestfinished', (request) => {
    if (new URL(request.url()).origin !== localOrigin) {
      completedExternalRequests.push({
        method: request.method(),
        url: request.url(),
      });
    }
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== localOrigin) {
      blockedExternalRequests.push({
        method: request.method(),
        url: request.url(),
      });
      await route.abort('blockedbyclient');
      return;
    }

    if (['font', 'image', 'media'].includes(request.resourceType())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  return {
    blockedExternalRequests,
    completedExternalRequests,
  };
}

let server;
let localOrigin;

test.beforeAll(async () => {
  server = createStaticServer();
  localOrigin = await listenOnEphemeralLoopback(server);
});

test.afterAll(async () => {
  await closeServer(server);
});

for (const [surfaceName, surface] of Object.entries(SURFACES)) {
  for (const viewport of VIEWPORTS) {
    test(`${surfaceName} is safe and reachable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const network = await installNetworkBarrier(page, localOrigin);

      await page.goto(`${localOrigin}${surface.path}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolveFrame) => {
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
        });
      });

      const ctaLabels = await page
        .locator('.waitlist-card .primary-button')
        .allTextContents();
      expect(ctaLabels.map((label) => label.trim())).toEqual(surface.ctas);

      const metadata = await page.evaluate(() => ({
        canonical:
          document
            .querySelector('link[rel="canonical"]')
            ?.getAttribute('href') ?? null,
        robots:
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content') ?? null,
      }));
      expect(metadata).toEqual({
        canonical: surface.canonical,
        robots: surface.robots,
      });

      const layout = await page.evaluate(() => {
        const input = document
          .querySelector('#waitlist-email')
          ?.getBoundingClientRect();
        const cta = document
          .querySelector('#waitlist-form button[type="submit"]')
          ?.getBoundingClientRect();
        return {
          bodyScrollWidth: document.body.scrollWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          innerHeight: window.innerHeight,
          innerWidth: window.innerWidth,
          inputBottom: input ? input.bottom : null,
          inputTop: input ? input.top : null,
          ctaBottom: cta ? cta.bottom : null,
          ctaTop: cta ? cta.top : null,
        };
      });

      expect(layout.inputTop).not.toBeNull();
      expect(layout.ctaTop).not.toBeNull();
      expect(layout.inputTop).toBeGreaterThanOrEqual(0);
      expect(layout.ctaTop).toBeGreaterThanOrEqual(0);
      expect(layout.inputBottom).toBeLessThanOrEqual(layout.innerHeight);
      expect(layout.ctaBottom).toBeLessThanOrEqual(layout.innerHeight);
      expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.innerWidth);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.innerWidth);

      expect(network.completedExternalRequests).toEqual([]);
      for (const request of network.blockedExternalRequests) {
        expect(new URL(request.url).origin).not.toBe(localOrigin);
      }
    });
  }
}

test('the browser guard fails every external write closed', async ({ page }) => {
  const network = await installNetworkBarrier(page, localOrigin);
  await page.goto(`${localOrigin}/start/`, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    try {
      await fetch('https://example.invalid/write-must-not-leave-loopback', {
        method: 'POST',
        body: 'blocked',
      });
      return 'unexpectedly-completed';
    } catch {
      return 'blocked';
    }
  });

  expect(result).toBe('blocked');
  expect(network.blockedExternalRequests).toContainEqual({
    method: 'POST',
    url: 'https://example.invalid/write-must-not-leave-loopback',
  });
  expect(network.completedExternalRequests).toEqual([]);
});

test('start resolves an allowlisted landing variant and rejects unknown variants', async ({
  page,
}) => {
  await installNetworkBarrier(page, localOrigin);
  await page.goto(
    `${localOrigin}/start/?landing_variant=manga-couples-activation-v1`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-landing-variant',
    'manga-couples-activation-v1',
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-landing-variant-source',
    'query',
  );

  await page.goto(
    `${localOrigin}/start/?landing_variant=unpublished-ad-promise`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-landing-variant',
    'manga-couples-activation-v1',
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-landing-variant-source',
    'default',
  );
});
