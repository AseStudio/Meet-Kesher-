import { useWindowDimensions } from 'react-native';

// Baseline: a standard phone width, same reference point Figma/most RN
// scaling utilities use. Everything scales relative to this.
const BASE_WIDTH = 375;

// Clamp factor so a giant desktop monitor doesn't blow toolbar buttons
// up to comical sizes, and a small phone doesn't shrink tap targets
// below a usable minimum.
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.45;

/**
 * useResponsive() — shared by SessionMain.js and AttendeeSession.js so
 * their in-session chrome (toolbar, video grid, dropdowns) scales the
 * same way on the same screen sizes, instead of each screen picking its
 * own fixed pixel values.
 *
 * Returns:
 *   width, height        — current window size (updates live on resize/rotate)
 *   scale(size)           — multiply a "phone-baseline" pixel value by the
 *                            current clamped scale factor. Use for anything
 *                            that should grow/shrink with screen size:
 *                            toolbar buttons, video tile dimensions, panel
 *                            widths, icon sizes.
 *   isSmall               — width < 380 (small phones — tighten spacing/labels)
 *   isTablet               — width >= 768 (tablet or small desktop window)
 *   isDesktop              — width >= 1100 (wide desktop/web — safe to show
 *                            more columns, wider side panels, larger toolbar)
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const rawScale = width / BASE_WIDTH;
  const scaleFactor = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));

  const scale = (size) => Math.round(size * scaleFactor);

  return {
    width,
    height,
    scale,
    isSmall: width < 380,
    isTablet: width >= 768,
    isDesktop: width >= 1100,
  };
}
