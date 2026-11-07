// ===== THEME =====
// Load this right after the Tailwind CDN script on every page.
// To match a different colour scheme, change the two palettes below; every page follows.
//   brand  = main colour (buttons, links, active menu, headers)
//   accent = highlight colour (badges, call-to-action buttons on dark backgrounds)
// "emerald" and "amber" are mapped to these palettes so the dashboard code picks them up without edits.
(function () {
  const brand = { 50: '#eef3ff', 100: '#dbe5ff', 200: '#bccdfe', 300: '#8fb0ff', 400: '#5d86f7', 500: '#3a63ea', 600: '#2849cc', 700: '#223ba6', 800: '#1d3285', 900: '#1a2b6b', 950: '#14215a' };
  const accent = { 50: '#fff8e6', 100: '#feefc2', 200: '#fde08a', 300: '#fbcd4f', 400: '#f5b72a', 500: '#e59a12', 600: '#c7770c', 700: '#9e550e', 800: '#814413', 900: '#6b3914', 950: '#3e1d06' };
  window.tailwind = window.tailwind || {};
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: { brand, accent, emerald: brand, amber: accent },
        fontFamily: {
          sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
          display: ['Fraunces', 'Georgia', 'serif'],
        },
      },
    },
  };
  document.head.insertAdjacentHTML('beforeend',
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<link rel="icon" href="logo.svg" type="image/svg+xml">' +
    '<style>body{font-family:"Plus Jakarta Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}</style>');
})();
