/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        forest: { 50: '#eff7f1', 100: '#dceee0', 500: '#3a8c57', 600: '#2d7548', 700: '#245d3b', 900: '#183b29' },
        ink: '#18231e',
      },
      boxShadow: {
        card: '0 12px 40px rgba(24, 59, 41, 0.06)',
      },
    },
  },
  plugins: [],
}
