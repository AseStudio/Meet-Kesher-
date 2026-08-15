// Shared logo geometry — 4 dots positioned on a circle, connected by quarter-circle arcs
export function getLogoGeometry(size = 160) {
  const C = size / 2;
  const R = size * 0.325;

  const DOTS = [
    { x: C,     y: C - R }, // top
    { x: C + R, y: C     }, // right
    { x: C,     y: C + R }, // bottom
    { x: C - R, y: C     }, // left
  ];

  // Quarter-circle arc length = (π/2) × R
  const ARC_LEN = parseFloat(((Math.PI / 2) * R).toFixed(2));

  // SVG path for the arc connecting DOTS[i] -> DOTS[i+1], curving clockwise around the circle
  const arcPath = (i) => {
    const from = DOTS[i];
    const to = DOTS[(i + 1) % 4];
    return `M ${from.x},${from.y} A ${R},${R} 0 0 1 ${to.x},${to.y}`;
  };

  return { SIZE: size, C, R, DOTS, ARC_LEN, arcPath };
}