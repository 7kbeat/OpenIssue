export interface ThumbMetrics {
  visible: boolean;
  thumbSize: number;
  thumbOffset: number;
  maxScroll: number;
  maxThumbOffset: number;
}

export interface ThumbComputeInput {
  viewportSize: number;
  contentSize: number;
  scrollOffset: number;
  trackSize?: number;
  minThumbSize?: number;
}

const DEFAULT_MIN_THUMB_SIZE = 28;
const OVERFLOW_EPSILON = 1;

export function calculateThumbMetrics({
  viewportSize,
  contentSize,
  scrollOffset,
  trackSize = viewportSize,
  minThumbSize = DEFAULT_MIN_THUMB_SIZE,
}: ThumbComputeInput): ThumbMetrics {
  if (
    viewportSize <= 0 ||
    trackSize <= 0 ||
    contentSize <= viewportSize + OVERFLOW_EPSILON
  ) {
    return {
      visible: false,
      thumbSize: 0,
      thumbOffset: 0,
      maxScroll: 0,
      maxThumbOffset: 0,
    };
  }

  const maxScroll = Math.max(0, contentSize - viewportSize);
  const clampedScroll = Math.min(Math.max(0, scrollOffset), maxScroll);
  const effectiveMinThumb = Math.min(minThumbSize, trackSize);
  const proportionalThumb = (viewportSize / contentSize) * trackSize;
  const thumbSize = Math.min(
    trackSize,
    Math.max(effectiveMinThumb, Math.round(proportionalThumb))
  );
  const maxThumbOffset = Math.max(0, trackSize - thumbSize);
  const scrollRatio = maxScroll > 0 ? clampedScroll / maxScroll : 0;
  const thumbOffset = Math.min(
    maxThumbOffset,
    Math.max(0, scrollRatio * maxThumbOffset)
  );

  return {
    visible: true,
    thumbSize,
    thumbOffset,
    maxScroll,
    maxThumbOffset,
  };
}

export function calculateScrollFromDrag(params: {
  startScrollOffset: number;
  pointerDelta: number;
  maxScroll: number;
  maxThumbOffset: number;
}): number {
  const { startScrollOffset, pointerDelta, maxScroll, maxThumbOffset } = params;
  if (maxScroll <= 0 || maxThumbOffset <= 0) return 0;
  const scrollDelta = (pointerDelta / maxThumbOffset) * maxScroll;
  return Math.min(maxScroll, Math.max(0, startScrollOffset + scrollDelta));
}

export function calculateScrollFromTrackClick(params: {
  clickPositionInTrack: number;
  thumbSize: number;
  trackSize: number;
  maxScroll: number;
}): number {
  const { clickPositionInTrack, thumbSize, trackSize, maxScroll } = params;
  const maxThumbOffset = Math.max(0, trackSize - thumbSize);
  if (maxScroll <= 0 || maxThumbOffset <= 0) return 0;
  const centeredOffset = clickPositionInTrack - thumbSize / 2;
  const clampedOffset = Math.min(maxThumbOffset, Math.max(0, centeredOffset));
  return (clampedOffset / maxThumbOffset) * maxScroll;
}
