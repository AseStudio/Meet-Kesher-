import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { getLogoGeometry } from './logoGeometry';
import { colors } from '../theme/colors';

export default function LogoMark({ size = 48, color = colors.white }) {
  const { DOTS, arcPath } = getLogoGeometry(size);
  const dotRadius = size * 0.0625;
  const strokeW = size * 0.022;

  return (
    <Svg width={size} height={size}>
      {[0, 1, 2, 3].map(i => (
        <Path
          key={`a${i}`}
          d={arcPath(i)}
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          fill="none"
        />
      ))}
      {DOTS.map((pos, i) => (
        <Circle key={`d${i}`} cx={pos.x} cy={pos.y} r={dotRadius} fill={color} />
      ))}
    </Svg>
  );
}