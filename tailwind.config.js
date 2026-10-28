/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Mirrors the CSS variables in globals.css — that file is the source of truth.
      colors: {
        pearl: 'var(--pearl)',
        surface: {
          DEFAULT: 'var(--surface)',
          sunken: 'var(--surface-sunken)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          soft: 'var(--ink-soft)',
          muted: 'var(--ink-muted)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        navy: {
          DEFAULT: 'var(--navy)',
          2: 'var(--navy-2)',
          3: 'var(--navy-3)',
        },
        orange: {
          DEFAULT: 'var(--orange)',
          hover: 'var(--orange-hover)',
          ink: 'var(--orange-ink)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
