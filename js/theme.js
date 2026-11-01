// Apply the saved theme before first paint to avoid a flash.
try {
  const t = JSON.parse(localStorage.getItem('bodyscan.v1') || '{}').theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable */ }
