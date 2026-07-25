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

export function attributionFromSearch(searchParams) {
  const attribution = {};
  for (const [queryKey, outputKey] of Object.entries(ATTRIBUTION_KEYS)) {
    const value = clean(searchParams.get(queryKey));
    if (value) attribution[outputKey] = value;
  }
  return attribution;
}

export function normalizeClientEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  return email;
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
