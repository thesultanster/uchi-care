export const START_LANDING_VARIANT_PARAM = 'landing_variant';
export const DEFAULT_START_LANDING_VARIANT = 'manga-couples-activation-v1';

const START_LANDING_VARIANTS = Object.freeze({
  [DEFAULT_START_LANDING_VARIANT]: Object.freeze({
    id: DEFAULT_START_LANDING_VARIANT,
    copy: Object.freeze({
      documentTitle: 'Sticky Chores — The Manga Chore Game for Couples',
      metaDescription:
        'Fight chores, not each other. Sticky Chores turns housework into manga cards, shared quests, and satisfying proof of done.',
      heroLead: 'Fight chores',
      heroEmphasis: 'Not each other',
      primaryCta: 'Get started →',
      secondaryCta: 'Get started ↑',
      finaleChapter: 'A calmer way to run your home',
      finaleHeadline: 'Make the invisible work visible.',
      finalePitch: 'Join couples testing Sticky Chores on iPhone first.',
    }),
  }),
});

const START_LANDING_VARIANT_ALIASES = Object.freeze({
  'manga-couples-coop-v3-web-onboarding': DEFAULT_START_LANDING_VARIANT,
  'web-early-access-v1': DEFAULT_START_LANDING_VARIANT,
});

const VARIANT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

function cleanVariantKey(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  return VARIANT_KEY_RE.test(candidate) ? candidate : null;
}

export function resolveStartLandingVariant(
  searchParams,
  {
    defaultVariant = DEFAULT_START_LANDING_VARIANT,
    variants = START_LANDING_VARIANTS,
    aliases = START_LANDING_VARIANT_ALIASES,
  } = {},
) {
  const firstConfiguredVariant = Object.keys(variants)[0];
  const safeDefault =
    cleanVariantKey(defaultVariant) && variants[defaultVariant]
      ? defaultVariant
      : variants[DEFAULT_START_LANDING_VARIANT]
        ? DEFAULT_START_LANDING_VARIANT
        : firstConfiguredVariant;
  const requested = cleanVariantKey(
    searchParams?.get?.(START_LANDING_VARIANT_PARAM),
  );
  const canonicalRequested = requested
    ? aliases[requested] ?? requested
    : null;
  const selected =
    canonicalRequested && variants[canonicalRequested]
      ? canonicalRequested
      : safeDefault;
  if (!selected || !variants[selected]) {
    throw new Error('At least one start landing variant must be configured.');
  }

  return Object.freeze({
    variant: variants[selected],
    source: canonicalRequested && variants[canonicalRequested] ? 'query' : 'default',
    fellBack: requested !== null && !variants[canonicalRequested],
  });
}

export function applyStartLandingVariant(documentRoot, resolution) {
  const variant = resolution?.variant;
  if (!documentRoot || !variant) return;

  documentRoot.title = variant.copy.documentTitle;
  const description = documentRoot.querySelector?.('meta[name="description"]');
  description?.setAttribute('content', variant.copy.metaDescription);

  for (const [slot, value] of Object.entries(variant.copy)) {
    if (slot === 'documentTitle' || slot === 'metaDescription') continue;
    documentRoot
      .querySelectorAll?.(`[data-landing-copy="${slot}"]`)
      .forEach((element) => {
        element.textContent = value;
      });
  }

  if (documentRoot.body?.dataset) {
    documentRoot.body.dataset.landingVariant = variant.id;
    documentRoot.body.dataset.landingVariantSource = resolution.source;
  }
}

export function startLandingVariantIds() {
  return Object.keys(START_LANDING_VARIANTS);
}
