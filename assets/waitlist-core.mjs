const ATTRIBUTION_KEYS = {
  utm_source: 'source',
  utm_medium: 'medium',
  utm_campaign: 'campaign',
  utm_content: 'content',
  utm_term: 'term',
  campaign_id: 'campaignId',
  adset_id: 'adsetId',
  ad_id: 'adId',
  placement: 'placement',
};
const ATTRIBUTION_OUTPUT_KEYS = Object.freeze(Object.values(ATTRIBUTION_KEYS));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CLICK_ID_RE = /^[A-Za-z0-9._-]{1,220}$/;

function clean(value, maxLength = 160) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, maxLength);
  return normalized || null;
}

export function allowlistedAttribution(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const attribution = {};
  for (const key of ATTRIBUTION_OUTPUT_KEYS) {
    const cleanedValue = clean(value[key]);
    if (cleanedValue) attribution[key] = cleanedValue;
  }
  return attribution;
}

export function attributionFromSearch(searchParams) {
  const attribution = {};
  for (const [queryKey, outputKey] of Object.entries(ATTRIBUTION_KEYS)) {
    const value = clean(searchParams.get(queryKey));
    if (value) attribution[outputKey] = value;
  }
  return allowlistedAttribution(attribution);
}

export function normalizeClientEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  return email;
}

export function webOnboardingHandoffPayload({
  email,
  sessionId,
  attribution = {},
  landingVariant,
  pagePath,
  captchaToken,
  company = '',
} = {}) {
  const payload = {
    email: normalizeClientEmail(email),
    attribution: allowlistedAttribution(attribution),
    company: clean(company) ?? '',
  };

  const optionalValues = {
    sessionId: clean(sessionId, 64),
    landingVariant: clean(landingVariant, 80),
    pagePath: clean(pagePath, 160),
    captchaToken: clean(captchaToken, 4096),
  };
  for (const [key, value] of Object.entries(optionalValues)) {
    if (value) payload[key] = value;
  }

  return payload;
}

export function webOnboardingRedirectUrl(handoffToken) {
  const token =
    typeof handoffToken === 'string' ? handoffToken.trim() : '';
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(token)) {
    throw new Error('Onboarding could not be started. Try again.');
  }

  const destination = new URL('https://stickychores.app/start');
  // Fragments are never sent in HTTP requests or hosting access logs. The
  // product reads this once in memory and scrubs it before any analytics run.
  destination.hash = `handoff=${encodeURIComponent(token)}`;
  return destination.toString();
}

export async function beginWebOnboarding({
  request,
  navigate,
  ...handoffInput
} = {}) {
  if (typeof request !== 'function' || typeof navigate !== 'function') {
    throw new Error('Onboarding could not be started. Try again.');
  }

  const result = await request(
    'create-web-onboarding-handoff',
    webOnboardingHandoffPayload(handoffInput),
  );
  const destination = webOnboardingRedirectUrl(result?.handoffToken);
  navigate(destination);
  return destination;
}

export function buildMetaClickCookie(clickId, nowMs = Date.now()) {
  if (
    typeof clickId !== 'string' ||
    !CLICK_ID_RE.test(clickId) ||
    !Number.isFinite(nowMs) ||
    nowMs <= 0
  ) {
    return null;
  }
  return `fb.1.${Math.floor(nowMs / 1000)}.${clickId}`;
}

export function adMeasurementAllowed({
  preference = null,
  globalPrivacyControl = false,
} = {}) {
  return globalPrivacyControl !== true && preference !== 'declined';
}

const ANALYTICS_ATTRIBUTION_KEYS = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  content: 'utm_content',
  term: 'utm_term',
  campaignId: 'campaign_id',
  adsetId: 'adset_id',
  adId: 'ad_id',
  placement: 'placement',
};

export function analyticsTrafficClass(attribution = {}) {
  const source = clean(attribution?.source)?.toLowerCase();
  const medium = clean(attribution?.medium)?.toLowerCase();

  if (source === 'meta' && medium === 'paid_social') return 'paid_meta';
  if (Object.values(attribution).some((value) => clean(value) !== null)) {
    return 'other_tagged';
  }
  return 'direct_or_unattributed';
}

export function analyticsEventProperties({
  sessionId,
  attribution = {},
  landingVariant,
  pagePath,
  acquisitionSurface,
  acquisitionMode,
} = {}) {
  const properties = {
    marketing_session_id: clean(sessionId, 64),
    landing_variant: clean(landingVariant, 80),
    page_path: clean(pagePath, 160),
    acquisition_surface: clean(acquisitionSurface, 40),
    acquisition_mode: clean(acquisitionMode, 40),
    traffic_class: analyticsTrafficClass(attribution),
  };

  for (const [inputKey, outputKey] of Object.entries(ANALYTICS_ATTRIBUTION_KEYS)) {
    const value = clean(attribution?.[inputKey]);
    if (value) properties[outputKey] = value;
  }

  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== null),
  );
}
