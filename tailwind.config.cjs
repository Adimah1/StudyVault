// Colors are CSS variables so the whole UI can switch between dark (default)
// and light themes by changing a single data attribute on <html>.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        elevated: v('elevated'),
        hover: v('hover'),
        line: v('border'),
        text: v('text'),
        muted: v('muted'),
        faint: v('faint'),
        accent: v('accent'),
        success: v('success'),
        danger: v('danger'),
        warning: v('warning'),
      },
      borderColor: {
        DEFAULT: v('border'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
