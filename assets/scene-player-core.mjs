export const DEFAULT_SCENE_DURATION = 6500;
export const FRAME_ANIMATION_MILESTONES = Object.freeze([25, 50, 75, 100]);

export function nextSceneIndex(currentIndex, sceneCount) {
  if (!Number.isInteger(sceneCount) || sceneCount < 1) return 0;
  const normalizedIndex =
    Number.isInteger(currentIndex) && currentIndex >= 0
      ? currentIndex % sceneCount
      : 0;
  return (normalizedIndex + 1) % sceneCount;
}

export function nextReadySceneIndex(currentIndex, readyIndexes) {
  const indexes = [
    ...new Set(
      readyIndexes.filter((index) => Number.isInteger(index) && index >= 0),
    ),
  ];
  if (indexes.length === 0) {
    return Number.isInteger(currentIndex) && currentIndex >= 0 ? currentIndex : 0;
  }

  const currentPosition = indexes.indexOf(currentIndex);
  if (currentPosition === -1) return indexes[0];
  return indexes[(currentPosition + 1) % indexes.length];
}

export function sceneDuration(value, fallback = DEFAULT_SCENE_DURATION) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1000), 30_000);
}

export function animationCycleDuration(values, fallback = DEFAULT_SCENE_DURATION) {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values.reduce(
    (total, value) => total + sceneDuration(value, fallback),
    0,
  );
}

export function reachedAnimationMilestones({
  previousElapsedMs = 0,
  elapsedMs = 0,
  totalDurationMs,
  milestones = FRAME_ANIMATION_MILESTONES,
} = {}) {
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) return [];

  const previousProgress =
    Math.max(0, Number(previousElapsedMs) || 0) / totalDurationMs * 100;
  const currentProgress =
    Math.max(0, Number(elapsedMs) || 0) / totalDurationMs * 100;

  return milestones.filter(
    (milestone) =>
      Number.isFinite(milestone) &&
      milestone > previousProgress &&
      milestone <= currentProgress,
  );
}

export function fittedSceneScale({
  frameHeight,
  frameWidth,
  contentHeight,
  contentWidth,
  contentLeft = 0,
  blockMargin = 16,
  inlineEndMargin = 18,
  minScale = 0.75,
  maxScale = 1.25,
}) {
  const measurements = [frameHeight, frameWidth, contentHeight, contentWidth];
  if (measurements.some((measurement) => !Number.isFinite(measurement) || measurement <= 0)) {
    return 1;
  }

  const availableHeight = Math.max(frameHeight - blockMargin * 2, 0);
  const availableWidth = Math.max(frameWidth - contentLeft - inlineEndMargin, 0);
  const fittedScale = Math.min(
    availableHeight / contentHeight,
    availableWidth / contentWidth,
  );
  return Math.min(Math.max(fittedScale, minScale), maxScale);
}
