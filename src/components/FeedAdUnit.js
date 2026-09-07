import React, { useEffect, useRef } from 'react';
import { View, Platform } from 'react-native';
import { loadAdSenseScript } from '../lib/adsense';

const ADSENSE_CLIENT = 'ca-pub-8987252550268346';
const ADSENSE_SLOT = '3047768455';
const ADSENSE_LAYOUT_KEY = '-6c+du+k-3x+d5';

// Web-only — AdSense has no native/mobile-app SDK at all (that's what
// AdMob is for, a separate product, not yet wired in). Native falls
// through to FeedTab's rotating placeholder text instead.
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

    // Two real bugs fixed here, found after the ad rendered an empty
    // box in production:
    //
    // 1. The push() call used to be wrapped in a try/catch that
    //    silently swallowed everything, including real errors — so if
    //    something WAS going wrong, there was no way to ever see it.
    //    Now logged instead of hidden.
    //
    // 2. AdSense's "fluid" format needs the <ins> element to already
    //    have a real, non-zero width at the exact moment push() runs.
    //    Pushing immediately on mount risks running before React
    //    Native Web's layout has actually committed real dimensions
    //    for this node yet — especially likely here since this mounts
    //    inside a virtualized FlatList item. When that race is lost,
    //    AdSense fails with "No slot size for availableWidth=0" and,
    //    critically, never retries on its own — the slot just stays
    //    permanently blank. A double requestAnimationFrame defers the
    //    push to the frame after layout has settled, which is the
    //    standard workaround for this exact failure mode.
    const pushAd = () => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        console.error('[FeedAdUnit] adsbygoogle push failed:', e);
      }
    };
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(pushAd);
      containerRef.current && (containerRef.current._raf2 = raf2);
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (containerRef.current?._raf2) cancelAnimationFrame(containerRef.current._raf2);
    };
  }, []);

  if (Platform.OS !== 'web') return null;

  return <View ref={containerRef} style={{ minHeight: 100, width: '100%' }} />;
}
