// Ensures adsbygoogle.js is only ever injected once, no matter how many
// FeedAdUnit instances end up mounted (one per ad slot in the feed).
// Loading it again per-instance would be wasteful and is explicitly
// against Google's own guidance for the script tag.
let scriptRequested = false;

export function loadAdSenseScript(publisherId) {
  if (typeof document === 'undefined' || scriptRequested) return;
  if (document.querySelector(`script[data-adsense-client="${publisherId}"]`)) {
    scriptRequested = true;
    return;
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
  script.crossOrigin = 'anonymous';
  script.setAttribute('data-adsense-client', publisherId);
  document.head.appendChild(script);
  scriptRequested = true;
}
