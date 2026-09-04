import React, { useEffect, useRef } from 'react';
import { View, Platform } from 'react-native';
import { loadAdSenseScript } from '../lib/adsense';

const ADSENSE_CLIENT = 'ca-pub-8987252550268346';
const ADSENSE_SLOT = '3047768455';
const ADSENSE_LAYOUT_KEY = '-6c+du+k-3x+d5';

// Web-only — AdSense has no native/mobile-app SDK at all (that's what
// AdMob is for, a separate product, not yet wired in). Native keeps
// showing the rotating placeholder text in FeedTab.js instead.
export default function FeedAdUnit() {
  const containerRef = useRef(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !containerRef.current) return;
    loadAdSenseScript(ADSENSE_CLIENT);

    // containerRef.current is the real DOM node here (RN Web forwards
    // View refs to it) — build the exact <ins> AdSense's own embed code
    // specifies, since there's no way to hand React Native JSX a raw
    // HTML tag directly.
    const node = containerRef.current;
    node.innerHTML = '';
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-format', 'fluid');
    ins.setAttribute('data-ad-layout-key', ADSENSE_LAYOUT_KEY);
    ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
    ins.setAttribute('data-ad-slot', ADSENSE_SLOT);
    node.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      // Can throw in a race where this runs a beat before the script
      // tag has actually finished loading — safe to ignore, worst case
      // this one slot just stays empty rather than the app crashing.
    }
  }, []);

  if (Platform.OS !== 'web') return null;

  return <View ref={containerRef} style={{ minHeight: 100, width: '100%' }} />;
}
