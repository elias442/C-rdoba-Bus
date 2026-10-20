/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#07111f',
          900: '#10203a',
          800: '#1a3358',
          700: '#2a4a78',
        },
        electric: {
          50: '#eef3ff',
          100: '#dce6ff',
          500: '#2f6bff',
          600: '#1f56e6',
        },
      },
      boxShadow: {
        panel: '0 22px 50px rgba(16, 32, 58, 0.16)',
      },
    },
  },
  plugins: [],
}
