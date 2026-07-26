import {
  adMeasurementAllowed,
  analyticsEventProperties,
  attributionFromSearch,
  buildMetaClickCookie,
  normalizeClientEmail,
} from './waitlist-core.mjs';
import {
  fittedSceneScale,
  nextReadySceneIndex,
  sceneDuration,
} from './scene-player-core.mjs';

const configuredApiBase =
  document.querySelector('meta[name="waitlist-api-base"]')?.content.replace(/\/$/, '') ?? '';
const IS_LOCALHOST =
  window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
const API_BASE =
  IS_LOCALHOST
    ? 'http://127.0.0.1:54421/functions/v1'
    : configuredApiBase;
const META_PIXEL_ID =
  document.querySelector('meta[name="meta-pixel-id"]')?.content.trim() ?? '';
const AMPLITUDE_API_KEY =
  document.querySelector('meta[name="amplitude-api-key"]')?.content.trim() ?? '';
const LANDING_VARIANT = document.body.dataset.landingVariant || 'manga-couples-v1';
const CONSENT_KEY = 'sticky_chores_ad_measurement';
const ATTRIBUTION_KEY = 'sticky_chores_session_attribution';
const SESSION_KEY = 'sticky_chores_marketing_session';
const search = new URLSearchParams(window.location.search);
const AMPLITUDE_EVENT_NAMES = {
  landing_view: 'Landing Viewed',
  form_start: 'Waitlist Form Started',
};
let amplitudeReadyPromise;
let amplitudeInitialized = false;
let amplitudeReplayPlugin;
let amplitudeReplayAdded = false;

function mountScenePlayer(root) {
  const scenes = [...root.querySelectorAll('[data-scene]')];
  const sceneVideos = [...root.querySelectorAll('[data-scene-video]')];
  const fittedCards = [...root.querySelectorAll('[data-scene-fit-height]')];
  const toggle = root.querySelector('[data-scene-toggle]');
  const toggleLabel = root.querySelector('[data-scene-toggle-label]');
  if (scenes.length === 0) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const requestedSceneId = search.get('scene');
  const requestedSceneIndex = scenes.findIndex(
    (scene) =>
      scene.dataset.sceneId === requestedSceneId &&
      scene.hasAttribute('data-scene-ready'),
  );
  let activeIndex = requestedSceneIndex >= 0
    ? requestedSceneIndex
    : Math.max(
        0,
        scenes.findIndex((scene) => scene.classList.contains('is-active')),
      );
  let timer;
  let isInViewport = true;
  let isUserPaused = false;

  function readySceneIndexes() {
    return scenes.flatMap((scene, index) =>
      scene.hasAttribute('data-scene-ready') ? [index] : [],
    );
  }

  function fitSceneCards() {
    const blockMargin =
      Number.parseFloat(
        window.getComputedStyle(root).getPropertyValue('--scene-card-block-margin'),
      ) || 16;

    fittedCards.forEach((card) => {
      const scale = fittedSceneScale({
        frameHeight: root.clientHeight,
        frameWidth: root.clientWidth,
        contentHeight: card.offsetHeight,
        contentWidth: card.offsetWidth,
        contentLeft: card.offsetLeft,
        blockMargin,
      });
      card.style.setProperty('--scene-card-scale', scale.toFixed(4));
    });
  }

  function canAutoplay() {
    return (
      readySceneIndexes().length > 0 &&
      !isUserPaused &&
      !reducedMotion.matches &&
      !document.hidden &&
      isInViewport
    );
  }

  function updateToggle() {
    if (!toggle || !toggleLabel) return;
    const paused = isUserPaused || reducedMotion.matches;
    toggle.hidden = !IS_LOCALHOST || reducedMotion.matches;
    toggle.setAttribute('aria-pressed', String(isUserPaused));
    toggleLabel.textContent = paused ? 'Play animation' : 'Pause animation';
  }

  function syncSceneVideos({ restartActive = false } = {}) {
    sceneVideos.forEach((video) => {
      const isActive = video.closest('[data-scene]') === scenes[activeIndex];

      if (!isActive) {
        video.pause();
        try {
          video.currentTime = 0;
        } catch {
          // The poster remains visible until enough metadata is available.
        }
        return;
      }

      if (restartActive) {
        try {
          video.currentTime = 0;
        } catch {
          // Playing from the poster is the correct fallback before metadata loads.
        }
      }

      if (!canAutoplay()) {
        video.pause();
        return;
      }

      video.play()?.catch(() => {
        // iOS or data-saving policies can decline autoplay; the poster remains usable.
      });
    });
  }

  function activateScene(nextIndex, reason = 'autoplay') {
    const previousIndex = activeIndex;
    const isReplay = nextIndex === activeIndex && reason !== 'init';
    if (isReplay) {
      scenes[activeIndex]?.classList.remove('is-active');
      void root.offsetWidth;
    }
    activeIndex = Math.min(Math.max(nextIndex, 0), scenes.length - 1);

    scenes.forEach((scene, index) => {
      const isActive = index === activeIndex;
      scene.classList.toggle('is-active', isActive);
      scene.setAttribute('aria-hidden', String(!isActive));
    });

    const duration = sceneDuration(
      scenes[activeIndex]?.dataset.sceneDuration,
      sceneDuration(root.dataset.sceneDuration),
    );
    root.dataset.activeScene = String(activeIndex + 1);
    root.style.setProperty('--scene-duration', `${duration}ms`);
    syncSceneVideos({
      restartActive: isReplay || previousIndex !== activeIndex || reason === 'init',
    });
    root.dispatchEvent(
      new CustomEvent('sticky-chores:scenechange', {
        detail: {
          activeIndex,
          previousIndex,
          reason,
          sceneId: scenes[activeIndex]?.dataset.sceneId,
        },
      }),
    );
  }

  function clearSceneTimer() {
    window.clearTimeout(timer);
    timer = undefined;
  }

  function scheduleNextScene() {
    clearSceneTimer();
    if (!canAutoplay()) return;
    const duration = sceneDuration(
      scenes[activeIndex]?.dataset.sceneDuration,
      sceneDuration(root.dataset.sceneDuration),
    );
    timer = window.setTimeout(() => {
      activateScene(nextReadySceneIndex(activeIndex, readySceneIndexes()));
      scheduleNextScene();
    }, duration);
  }

  function syncPlayback() {
    updateToggle();
    syncSceneVideos();
    scheduleNextScene();
  }

  toggle?.addEventListener('click', () => {
    isUserPaused = !isUserPaused;
    syncPlayback();
  });

  root.addEventListener('sticky-chores:scenecomplete', () => {
    if (!canAutoplay()) return;
    activateScene(
      nextReadySceneIndex(activeIndex, readySceneIndexes()),
      'scenecomplete',
    );
    scheduleNextScene();
  });

  document.addEventListener('visibilitychange', syncPlayback);
  reducedMotion.addEventListener?.('change', syncPlayback);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      isInViewport = entry?.isIntersecting ?? true;
      syncPlayback();
    }, { threshold: 0.2 });
    observer.observe(root);
  }

  if ('ResizeObserver' in window) {
    const sizeObserver = new ResizeObserver(fitSceneCards);
    sizeObserver.observe(root);
  } else {
    window.addEventListener('resize', fitSceneCards);
  }

  window.requestAnimationFrame(fitSceneCards);
  activateScene(activeIndex, 'init');
  syncPlayback();
}

document.querySelectorAll('[data-scene-player]').forEach(mountScenePlayer);

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

function loadExternalScript(source, marker) {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[${marker}]`);
    if (existingScript) {
      existingScript.addEventListener('load', resolve, { once: true });
      existingScript.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute(marker, 'true');
    script.src = source;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.append(script);
  });
}

async function loadAmplitudeScript() {
  if (!window.amplitude) {
    await loadExternalScript(
      'https://cdn.amplitude.com/libs/analytics-browser-2.44.4-min.js.gz',
      'data-amplitude-analytics-loader',
    );
  }
  if (!window.sessionReplay) {
    await loadExternalScript(
      'https://cdn.amplitude.com/libs/plugin-session-replay-browser-1.33.0-min.js.gz',
      'data-amplitude-replay-loader',
    );
  }
}

async function addAmplitudeReplay() {
  if (!window.sessionReplay || amplitudeReplayAdded) return;
  amplitudeReplayPlugin ||= window.sessionReplay.plugin({
    sampleRate: 1,
    privacyConfig: {
      defaultMaskLevel: 'light',
      maskSelector: ['#waitlist-email', '.form-status'],
    },
  });
  await window.amplitude.add(amplitudeReplayPlugin).promise;
  amplitudeReplayAdded = true;
}

async function enableAmplitudeMeasurement() {
  if (!AMPLITUDE_API_KEY || !hasAdMeasurementConsent()) return null;

  if (amplitudeInitialized) {
    window.amplitude.setOptOut(false);
    await addAmplitudeReplay();
    return window.amplitude;
  }

  amplitudeReadyPromise ||= (async () => {
    await loadAmplitudeScript();
    if (!hasAdMeasurementConsent() || !window.amplitude) return null;

    await addAmplitudeReplay();
    await window.amplitude.init(AMPLITUDE_API_KEY, {
      fetchRemoteConfig: false,
      autocapture: {
        attribution: false,
        fileDownloads: false,
        formInteractions: false,
        pageViews: false,
        sessions: true,
        elementInteractions: true,
        networkTracking: false,
        pageUrlEnrichment: false,
        webVitals: false,
        frustrationInteractions: true,
      },
      trackingOptions: {
        ipAddress: false,
      },
    }).promise;
    window.amplitude.setOptOut(false);
    amplitudeInitialized = true;
    return window.amplitude;
  })().catch(() => {
    amplitudeReadyPromise = undefined;
    return null;
  });

  const amplitude = await amplitudeReadyPromise;
  if (!amplitude) amplitudeReadyPromise = undefined;
  return amplitude;
}

async function disableAmplitudeMeasurement() {
  if (!window.amplitude) return;
  window.amplitude.setOptOut(true);
  if (!amplitudeReplayPlugin || !amplitudeReplayAdded) return;

  try {
    await window.amplitude.remove(amplitudeReplayPlugin.name).promise;
    amplitudeReplayAdded = false;
  } catch {
    // Analytics opt-out is already active; replay cleanup can retry next load.
  }
}

function trackAmplitudeEvent(eventName, additionalProperties = {}) {
  if (!hasAdMeasurementConsent()) return;
  const properties = {
    ...analyticsEventProperties({
      sessionId,
      attribution,
      landingVariant: LANDING_VARIANT,
      pagePath: window.location.pathname,
    }),
    ...additionalProperties,
  };

  void enableAmplitudeMeasurement().then((amplitude) => {
    amplitude?.track(AMPLITUDE_EVENT_NAMES[eventName] || eventName, properties);
  });
}

export function trackCustomEvent(eventName) {
  trackAmplitudeEvent(eventName);
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
  return adMeasurementAllowed({
    preference: consentState(),
    globalPrivacyControl: navigator.globalPrivacyControl === true,
  });
}

function loadMetaPixel() {
  if (IS_LOCALHOST || !META_PIXEL_ID || window.fbq) return;
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

function clearMetaMeasurementCookies() {
  for (const name of ['_fbp', '_fbc']) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  }
}

const privacyChoicesToggle = document.getElementById('privacy-choices-toggle');
const privacyChoicesPanel = document.getElementById('privacy-choices-panel');
const measurementStatus = document.getElementById('measurement-status');
const enableMeasurement = document.getElementById('enable-measurement');
const disableMeasurement = document.getElementById('disable-measurement');
const closePrivacyChoices = document.getElementById('close-privacy-choices');

function updatePrivacyChoices() {
  const blockedByGpc = navigator.globalPrivacyControl === true;
  const allowed = hasAdMeasurementConsent();
  if (measurementStatus) {
    measurementStatus.textContent = blockedByGpc
      ? 'Website measurement is off because your browser sent Global Privacy Control.'
      : allowed
        ? 'Amplitude analytics and replay plus Meta ad measurement are on. You can turn them off without affecting your waitlist spot.'
        : 'Amplitude analytics and replay plus Meta ad measurement are off. You can turn them back on at any time.';
  }
  enableMeasurement?.toggleAttribute('hidden', allowed || blockedByGpc);
  disableMeasurement?.toggleAttribute('hidden', !allowed || blockedByGpc);
}

function closePrivacyPanel() {
  privacyChoicesPanel?.setAttribute('hidden', '');
  privacyChoicesToggle?.setAttribute('aria-expanded', 'false');
}

if (hasAdMeasurementConsent()) {
  if (!IS_LOCALHOST && META_PIXEL_ID) loadMetaPixel();
  void enableAmplitudeMeasurement();
}
updatePrivacyChoices();

privacyChoicesToggle?.addEventListener('click', () => {
  const willOpen = privacyChoicesPanel?.hasAttribute('hidden') ?? false;
  privacyChoicesPanel?.toggleAttribute('hidden', !willOpen);
  privacyChoicesToggle.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) updatePrivacyChoices();
});

enableMeasurement?.addEventListener('click', () => {
  safeStorage(localStorage, 'set', CONSENT_KEY, 'accepted');
  if (window.fbq) {
    window.fbq('consent', 'grant');
    window.fbq('track', 'PageView');
  } else {
    loadMetaPixel();
  }
  void enableAmplitudeMeasurement();
  updatePrivacyChoices();
});

disableMeasurement?.addEventListener('click', () => {
  safeStorage(localStorage, 'set', CONSENT_KEY, 'declined');
  window.fbq?.('consent', 'revoke');
  clearMetaMeasurementCookies();
  void disableAmplitudeMeasurement();
  updatePrivacyChoices();
});

closePrivacyChoices?.addEventListener('click', closePrivacyPanel);

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
    trackAmplitudeEvent('Waitlist Submitted', {
      email_delivery: result.emailDelivery === 'delayed' ? 'delayed' : 'sent',
      is_new_lead: result.isNewLead === true,
    });

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
