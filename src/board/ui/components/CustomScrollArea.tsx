import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  calculateScrollFromDrag,
  calculateScrollFromTrackClick,
  calculateThumbMetrics,
  type ThumbMetrics,
} from '../utils/scrollbar';

export type ScrollDirection = 'vertical' | 'horizontal' | 'both';
export type ScrollTone = 'light' | 'dark';

const EMPTY_THUMB: ThumbMetrics = {
  visible: false,
  thumbSize: 0,
  thumbOffset: 0,
  maxScroll: 0,
  maxThumbOffset: 0,
};

function isSameThumb(a: ThumbMetrics, b: ThumbMetrics): boolean {
  return (
    a.visible === b.visible &&
    a.thumbSize === b.thumbSize &&
    Math.abs(a.thumbOffset - b.thumbOffset) < 0.5 &&
    Math.abs(a.maxScroll - b.maxScroll) < 0.5 &&
    Math.abs(a.maxThumbOffset - b.maxThumbOffset) < 0.5
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export interface UseCustomScrollbarOptions {
  direction?: ScrollDirection;
  enabled?: boolean;
  /** Optional dependency key to trigger recomputation when controlled text changes (e.g. textarea value). */
  contentKey?: string | number;
}

export interface CustomScrollbarController<T extends HTMLElement = HTMLDivElement> {
  viewportRef: React.RefObject<T | null>;
  vertical: ThumbMetrics;
  horizontal: ThumbMetrics;
  isScrolling: boolean;
  draggingAxis: 'vertical' | 'horizontal' | null;
  recompute: () => void;
  startThumbDrag: (
    axis: 'vertical' | 'horizontal',
    e: React.PointerEvent<HTMLDivElement>
  ) => void;
  handleTrackPointerDown: (
    axis: 'vertical' | 'horizontal',
    e: React.PointerEvent<HTMLDivElement>
  ) => void;
}

const RAIL_PADDING = 4; // 2px top + 2px bottom inset on the track
const CORNER_GAP = 12; // Clearance when both vertical and horizontal rails are shown

export function useCustomScrollbar<T extends HTMLElement = HTMLDivElement>({
  direction = 'vertical',
  enabled = true,
  contentKey,
}: UseCustomScrollbarOptions = {}): CustomScrollbarController<T> {
  const viewportRef = useRef<T | null>(null);
  const [vertical, setVertical] = useState<ThumbMetrics>(EMPTY_THUMB);
  const [horizontal, setHorizontal] = useState<ThumbMetrics>(EMPTY_THUMB);
  const [isScrolling, setIsScrolling] = useState(false);
  const [draggingAxis, setDraggingAxis] = useState<'vertical' | 'horizontal' | null>(
    null
  );
  const scrollTimerRef = useRef<number | null>(null);

  const allowV = enabled && (direction === 'vertical' || direction === 'both');
  const allowH = enabled && (direction === 'horizontal' || direction === 'both');

  const recompute = useCallback(() => {
    const el = viewportRef.current;
    if (!el || !enabled) {
      setVertical((prev) => (prev.visible ? EMPTY_THUMB : prev));
      setHorizontal((prev) => (prev.visible ? EMPTY_THUMB : prev));
      return;
    }

    const clientW = el.clientWidth;
    const clientH = el.clientHeight;
    const scrollW = el.scrollWidth;
    const scrollH = el.scrollHeight;

    const rawHasV = allowV && scrollH > clientH + 1;
    const rawHasH = allowH && scrollW > clientW + 1;

    const vTrackSize = Math.max(
      0,
      clientH - RAIL_PADDING - (rawHasH ? CORNER_GAP : 0)
    );
    const hTrackSize = Math.max(
      0,
      clientW - RAIL_PADDING - (rawHasV ? CORNER_GAP : 0)
    );

    const nextV = allowV
      ? calculateThumbMetrics({
          viewportSize: clientH,
          contentSize: scrollH,
          scrollOffset: el.scrollTop,
          trackSize: vTrackSize,
        })
      : EMPTY_THUMB;

    const nextH = allowH
      ? calculateThumbMetrics({
          viewportSize: clientW,
          contentSize: scrollW,
          scrollOffset: el.scrollLeft,
          trackSize: hTrackSize,
        })
      : EMPTY_THUMB;

    setVertical((prev) => (isSameThumb(prev, nextV) ? prev : nextV));
    setHorizontal((prev) => (isSameThumb(prev, nextH) ? prev : nextH));
  }, [allowH, allowV, enabled]);

  useEffect(() => {
    recompute();
  }, [recompute, contentKey]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !enabled) return;

    let rafId = 0;
    const scheduleRecompute = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        recompute();
      });
    };

    const handleScroll = () => {
      recompute();
      setIsScrolling(true);
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
      scrollTimerRef.current = window.setTimeout(() => {
        setIsScrolling(false);
      }, 900);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(scheduleRecompute);
    resizeObserver.observe(el);
    Array.from(el.children).forEach((child) => resizeObserver.observe(child));

    const mutationObserver = new MutationObserver(() => {
      Array.from(el.children).forEach((child) => resizeObserver.observe(child));
      scheduleRecompute();
    });
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Recompute once layout settles
    scheduleRecompute();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
      el.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [enabled, recompute]);

  const startThumbDrag = useCallback(
    (axis: 'vertical' | 'horizontal', e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = viewportRef.current;
      if (!el) return;

      const metrics = axis === 'vertical' ? vertical : horizontal;
      if (!metrics.visible || metrics.maxScroll <= 0 || metrics.maxThumbOffset <= 0) {
        return;
      }

      const startPointer = axis === 'vertical' ? e.clientY : e.clientX;
      const startScrollOffset = axis === 'vertical' ? el.scrollTop : el.scrollLeft;

      setDraggingAxis(axis);
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const currentPointer =
          axis === 'vertical' ? moveEvent.clientY : moveEvent.clientX;
        const delta = currentPointer - startPointer;
        const nextScroll = calculateScrollFromDrag({
          startScrollOffset,
          pointerDelta: delta,
          maxScroll: metrics.maxScroll,
          maxThumbOffset: metrics.maxThumbOffset,
        });
        if (axis === 'vertical') {
          el.scrollTop = nextScroll;
        } else {
          el.scrollLeft = nextScroll;
        }
      };

      const stopDrag = () => {
        setDraggingAxis(null);
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopDrag);
        window.removeEventListener('pointercancel', stopDrag);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);
    },
    [horizontal, vertical]
  );

  const handleTrackPointerDown = useCallback(
    (axis: 'vertical' | 'horizontal', e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      const el = viewportRef.current;
      if (!el) return;

      const metrics = axis === 'vertical' ? vertical : horizontal;
      if (!metrics.visible) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const clickPositionInTrack =
        axis === 'vertical' ? e.clientY - rect.top : e.clientX - rect.left;
      const trackSize = axis === 'vertical' ? rect.height : rect.width;

      const targetScroll = calculateScrollFromTrackClick({
        clickPositionInTrack,
        thumbSize: metrics.thumbSize,
        trackSize,
        maxScroll: metrics.maxScroll,
      });

      if (axis === 'vertical') {
        el.scrollTop = targetScroll;
      } else {
        el.scrollLeft = targetScroll;
      }
    },
    [horizontal, vertical]
  );

  return {
    viewportRef,
    vertical,
    horizontal,
    isScrolling,
    draggingAxis,
    recompute,
    startThumbDrag,
    handleTrackPointerDown,
  };
}

interface CustomScrollTracksProps<T extends HTMLElement> {
  controller: CustomScrollbarController<T>;
  tone?: ScrollTone;
  isHovered?: boolean;
}

export function CustomScrollTracks<T extends HTMLElement>({
  controller,
  tone = 'light',
  isHovered = false,
}: CustomScrollTracksProps<T>) {
  const { vertical, horizontal, isScrolling, draggingAxis, startThumbDrag, handleTrackPointerDown } =
    controller;

  const hasBoth = vertical.visible && horizontal.visible;
  const active = isHovered || isScrolling || draggingAxis !== null;

  const trackBg =
    tone === 'dark'
      ? 'hover:bg-white/[0.06]'
      : 'hover:bg-slate-900/[0.04]';

  const thumbBase =
    tone === 'dark'
      ? 'bg-white/30 hover:bg-white/50'
      : 'bg-slate-400/60 hover:bg-slate-500/80';

  const thumbDragging =
    tone === 'dark' ? 'bg-white/70' : 'bg-slate-600/90';

  return (
    <>
      {vertical.visible && (
        <div
          aria-hidden="true"
          data-custom-scrollbar-track="vertical"
          onPointerDown={(e) => handleTrackPointerDown('vertical', e)}
          className={`absolute right-0 top-0.5 z-20 w-2.5 px-[2px] transition-colors duration-150 select-none ${
            hasBoth ? 'bottom-3' : 'bottom-0.5'
          } ${trackBg} ${active ? 'opacity-100' : 'opacity-75'}`}
        >
          <div
            data-custom-scrollbar-thumb="vertical"
            onPointerDown={(e) => startThumbDrag('vertical', e)}
            style={{
              height: `${vertical.thumbSize}px`,
              transform: `translateY(${vertical.thumbOffset}px)`,
            }}
            className={`w-full rounded-full transition-colors duration-150 cursor-grab active:cursor-grabbing ${
              draggingAxis === 'vertical' ? thumbDragging : thumbBase
            }`}
          />
        </div>
      )}

      {horizontal.visible && (
        <div
          aria-hidden="true"
          data-custom-scrollbar-track="horizontal"
          onPointerDown={(e) => handleTrackPointerDown('horizontal', e)}
          className={`absolute bottom-0 left-0.5 z-20 h-2.5 py-[2px] transition-colors duration-150 select-none ${
            hasBoth ? 'right-3' : 'right-0.5'
          } ${trackBg} ${active ? 'opacity-100' : 'opacity-75'}`}
        >
          <div
            data-custom-scrollbar-thumb="horizontal"
            onPointerDown={(e) => startThumbDrag('horizontal', e)}
            style={{
              width: `${horizontal.thumbSize}px`,
              transform: `translateX(${horizontal.thumbOffset}px)`,
            }}
            className={`h-full rounded-full transition-colors duration-150 cursor-grab active:cursor-grabbing ${
              draggingAxis === 'horizontal' ? thumbDragging : thumbBase
            }`}
          />
        </div>
      )}
    </>
  );
}

interface CustomScrollAreaProps {
  as?: 'div' | 'main' | 'section' | 'aside';
  viewportAs?: 'div' | 'ul';
  direction?: ScrollDirection;
  tone?: ScrollTone;
  enabled?: boolean;
  /** Set true when container sizes to content up to a max-height (e.g. max-h-56) instead of flex-1 filling parent height. */
  autoHeight?: boolean;
  className?: string;
  viewportClassName?: string;
  ariaLabel?: string;
  ariaBusy?: boolean;
  dataTestId?: string;
  children: React.ReactNode;
}

export const CustomScrollArea: React.FC<CustomScrollAreaProps> = ({
  as = 'div',
  viewportAs = 'div',
  direction = 'vertical',
  tone = 'light',
  enabled = true,
  autoHeight = false,
  className = '',
  viewportClassName = '',
  ariaLabel,
  ariaBusy,
  dataTestId,
  children,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const controller = useCustomScrollbar<HTMLDivElement>({
    direction,
    enabled,
  });

  const overflowClass = !enabled
    ? ''
    : direction === 'both'
      ? 'overflow-auto'
      : direction === 'horizontal'
        ? 'overflow-x-auto overflow-y-hidden'
        : 'overflow-y-auto overflow-x-hidden';

  const OuterTag = as;
  const ViewportTag = viewportAs as 'div';

  if (!enabled) {
    return (
      <OuterTag
        aria-label={ariaLabel}
        aria-busy={ariaBusy}
        data-testid={dataTestId}
        className={className}
      >
        {children}
      </OuterTag>
    );
  }

  return (
    <OuterTag
      aria-label={ariaLabel}
      aria-busy={ariaBusy}
      data-testid={dataTestId}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative min-h-0 min-w-0 overflow-hidden ${
        autoHeight ? '' : 'flex flex-col'
      } ${className}`}
    >
      <ViewportTag
        ref={controller.viewportRef}
        className={`no-native-scrollbar min-h-0 min-w-0 w-full ${
          autoHeight ? '' : 'flex-1'
        } ${overflowClass} ${viewportClassName}`}
      >
        {children}
      </ViewportTag>
      <CustomScrollTracks
        controller={controller}
        tone={tone}
        isHovered={isHovered}
      />
    </OuterTag>
  );
};
