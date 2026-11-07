// Tailwind settings for the site. After changing colours here, or adding new classes to any page, rebuild tailwind.css:
//   npx tailwindcss@3.4.17 -i ./src/input.css -o ./tailwind.css --minify
// (or: npm run build). The pages load the finished tailwind.css, so visitors' browsers do no CSS work.
//   brand  = main colour (buttons, links, menu, headers)    accent = highlight colour (gold buttons, badges)
// "emerald" and "amber" are mapped to these so the dashboard code follows without edits.
const brand = { 50: '#eef3ff', 100: '#dbe5ff', 200: '#bccdfe', 300: '#8fb0ff', 400: '#5d86f7', 500: '#3a63ea', 600: '#2849cc', 700: '#223ba6', 800: '#1d3285', 900: '#1a2b6b', 950: '#14215a' };
const accent = { 50: '#fff8e6', 100: '#feefc2', 200: '#fde08a', 300: '#fbcd4f', 400: '#f5b72a', 500: '#e59a12', 600: '#c7770c', 700: '#9e550e', 800: '#814413', 900: '#6b3914', 950: '#3e1d06' };
module.exports = {
  content: ['./*.html', './app.js', './mock.js', './pdf.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: { brand, accent, emerald: brand, amber: accent },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'], display: ['Fraunces', 'Georgia', 'serif'] },
    },
  },
};
