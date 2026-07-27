import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const templatePath = resolve(scriptDirectory, 'templates/acquisition-page.html');

export const ACQUISITION_VARIANTS = Object.freeze({
  waitlist: Object.freeze({
    outputPath: 'waitlist/index.html',
    replacements: Object.freeze({
      ROBOTS_META: '',
      CANONICAL_URL: 'https://uchi.care/waitlist/',
      LANDING_VARIANT: 'manga-couples-coop-v3-us-optout',
      ACQUISITION_MODE: 'waitlist',
      PRIMARY_CTA: 'Join the waitlist →',
      SECONDARY_CTA: 'Join the waitlist ↑',
      TURNSTILE_SITE_KEY: '0x4AAAAAAD-jFTnrv9lm3glJ',
    }),
  }),
  start: Object.freeze({
    outputPath: 'start/index.html',
    replacements: Object.freeze({
      ROBOTS_META: '    <meta name="robots" content="noindex, nofollow">\n',
      CANONICAL_URL: 'https://uchi.care/start/',
      LANDING_VARIANT: 'manga-couples-activation-v1',
      ACQUISITION_MODE: 'web-onboarding',
      PRIMARY_CTA: 'Get started →',
      SECONDARY_CTA: 'Get started ↑',
      TURNSTILE_SITE_KEY: '0x4AAAAAAD-jFTnrv9lm3glJ',
    }),
  }),
});

const PLACEHOLDER_PATTERN = /\{\{([A-Z_]+)\}\}/g;

export function renderAcquisitionPage(template, variantName) {
  const variant = ACQUISITION_VARIANTS[variantName];
  if (!variant) {
    throw new Error(`Unknown acquisition page variant: ${variantName}`);
  }

  const usedPlaceholders = new Set();
  const rendered = template.replace(
    PLACEHOLDER_PATTERN,
    (placeholder, replacementKey) => {
      if (!(replacementKey in variant.replacements)) {
        throw new Error(
          `Missing ${replacementKey} replacement for ${variantName}`,
        );
      }
      usedPlaceholders.add(replacementKey);
      return variant.replacements[replacementKey];
    },
  );

  const unusedReplacements = Object.keys(variant.replacements).filter(
    (key) => !usedPlaceholders.has(key),
  );
  if (unusedReplacements.length > 0) {
    throw new Error(
      `Unused ${variantName} replacements: ${unusedReplacements.join(', ')}`,
    );
  }
  if (PLACEHOLDER_PATTERN.test(rendered)) {
    throw new Error(`Unresolved placeholder in ${variantName} page`);
  }

  return rendered;
}

export function generateAcquisitionPages({
  rootDirectory = repositoryRoot,
  sourceTemplate = readFileSync(templatePath, 'utf8'),
} = {}) {
  for (const [variantName, variant] of Object.entries(ACQUISITION_VARIANTS)) {
    const outputPath = resolve(rootDirectory, variant.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      renderAcquisitionPage(sourceTemplate, variantName),
      'utf8',
    );
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  generateAcquisitionPages();
}
