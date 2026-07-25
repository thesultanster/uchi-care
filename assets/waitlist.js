import {
  attributionFromSearch,
  buildMetaClickCookie,
  normalizeClientEmail,
} from './waitlist-core.mjs';

const configuredApiBase =
  document.querySelector('meta[name="waitlist-api-base"]')?.content.replace(/\/$/, '') ?? '';
const API_BASE =
  window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:54421/functions/v1'
    : configuredApiBase;
const META_PIXEL_ID =
  document.querySelector('meta[name="meta-pixel-id"]')?.content.trim() ?? '';
const LANDING_VARIANT = document.body.dataset.landingVariant || 'manga-couples-v1';
const CONSENT_KEY = 'sticky_chores_ad_measurement';
const ATTRIBUTION_KEY = 'sticky_chores_session_attribution';
const SESSION_KEY = 'sticky_chores_marketing_session';
const search = new URLSearchParams(window.location.search);

function safeStorage(storage, operation, key, value) {
  try {
    if (operation === 'get') return storage.getItem(key);
    if (operation === 'set') storage.setItem(key, value);
  } catch {
    return null;
  }
  return null;
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
}

const existingSession = safeStorage(sessionStorage, 'get', SESSION_KEY);
const sessionId = existingSession || uuid();
if (!existingSession) safeStorage(sessionStorage, 'set', SESSION_KEY, sessionId);

const searchAttribution = attributionFromSearch(search);
const storedAttribution = safeStorage(sessionStorage, 'get', ATTRIBUTION_KEY);
let attribution = searchAttribution;
if (Object.keys(searchAttribution).length > 0) {
  safeStorage(sessionStorage, 'set', ATTRIBUTION_KEY, JSON.stringify(searchAttribution));
} else if (storedAttribution) {
  try {
    attribution = JSON.parse(storedAttribution);
  } catch {
    attribution = {};
  }
}

async function postJson(path, payload, { keepalive = false } = {}) {
  if (!API_BASE) throw new Error('Waitlist service is not configured.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The request did not finish.');
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The request timed out. Try again.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function trackCustomEvent(eventName) {
  return postJson(
    'marketing-event',
    {
      eventName,
      eventId: uuid(),
      sessionId,
      attribution,
      landingVariant: LANDING_VARIANT,
      pagePath: window.location.pathname,
    },
    { keepalive: true },
  ).catch(() => undefined);
}

const pageViewKey = `sticky_chores_viewed:${window.location.pathname}`;
if (!safeStorage(sessionStorage, 'get', pageViewKey)) {
  safeStorage(sessionStorage, 'set', pageViewKey, '1');
  trackCustomEvent('landing_view');
}

function readCookie(name) {
  const prefix = `${name}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function consentState() {
  return safeStorage(localStorage, 'get', CONSENT_KEY);
}

function hasAdMeasurementConsent() {
  return consentState() === 'accepted';
}

function loadMetaPixel() {
  if (!META_PIXEL_ID || window.fbq) return;
  const fbq = function (...args) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  };
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.append(script);
  fbq('init', META_PIXEL_ID);
  fbq('track', 'PageView');
}

const consentBanner = document.getElementById('measurement-consent');
const acceptMeasurement = document.getElementById('accept-measurement');
const declineMeasurement = document.getElementById('decline-measurement');

if (META_PIXEL_ID) {
  if (hasAdMeasurementConsent()) loadMetaPixel();
  if (!consentState()) consentBanner?.removeAttribute('hidden');
}

acceptMeasurement?.addEventListener('click', () => {
  safeStorage(localStorage, 'set', CONSENT_KEY, 'accepted');
  consentBanner?.setAttribute('hidden', '');
  loadMetaPixel();
});

declineMeasurement?.addEventListener('click', () => {
  safeStorage(localStorage, 'set', CONSENT_KEY, 'declined');
  consentBanner?.setAttribute('hidden', '');
});

const form = document.getElementById('waitlist-form');
const emailInput = form?.elements.namedItem('email');
const formStatus = document.getElementById('form-status');
const submitButton = form?.querySelector('button[type="submit"]');
let formStarted = false;

form?.addEventListener('focusin', () => {
  if (formStarted) return;
  formStarted = true;
  trackCustomEvent('form_start');
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!emailInput || !submitButton || !formStatus) return;

  formStatus.className = 'form-status';
  formStatus.textContent = '';
  let email;
  try {
    email = normalizeClientEmail(emailInput.value);
  } catch (error) {
    formStatus.classList.add('is-error');
    formStatus.textContent = error.message;
    emailInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.dataset.originalLabel ||= submitButton.textContent;
  submitButton.textContent = 'Saving your spot…';

  try {
    const adConsent = hasAdMeasurementConsent();
    const fbclid = search.get('fbclid');
    const result = await postJson('waitlist-signup', {
      email,
      painPoint: form.elements.namedItem('painPoint')?.value || null,
      company: form.elements.namedItem('company')?.value || '',
      sessionId,
      eventId: uuid(),
      attribution,
      landingVariant: LANDING_VARIANT,
      pagePath: window.location.pathname,
      adMeasurementConsent: adConsent,
      fbp: adConsent ? readCookie('_fbp') : null,
      fbc: adConsent ? readCookie('_fbc') || buildMetaClickCookie(fbclid) : null,
    });

    if (result.isNewLead && adConsent && window.fbq) {
      window.fbq('track', 'Lead', {}, { eventID: result.eventId });
    }

    form.classList.add('is-complete');
    formStatus.classList.add('is-success');
    formStatus.textContent =
      result.emailDelivery === 'delayed'
        ? 'Your spot is saved. The confirmation email may take a little longer—check again soon.'
        : 'Check your inbox and confirm your spot. You’re one tap away.';
    emailInput.setAttribute('disabled', '');
    const painPoint = form.elements.namedItem('painPoint');
    if (painPoint) painPoint.setAttribute('disabled', '');
    submitButton.textContent = 'Spot saved ✓';
  } catch (error) {
    formStatus.classList.add('is-error');
    formStatus.textContent = error.message || 'We could not save your spot. Try again.';
    submitButton.disabled = false;
    submitButton.textContent = submitButton.dataset.originalLabel;
  }
});
