/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: '#0e1621',
          panel: '#17212b',
          hover: '#202b36',
          active: '#2b5278',
          border: '#101921',
          text: '#ffffff',
          subtext: '#7a8a99',
          accent: '#5288c1',
          accent2: '#3a6da3',
          green: '#4fae6e',
          red: '#e53935',
          blue: '#3a92dc',
          yellow: '#f5a623',
        },
      },
      fontFamily: {
        sans: ['Vazirmatn', 'sans-serif'],
      },
      animation: {
        'scaleIn': 'scaleIn 0.15s ease-out',
        'slideUp': 'slideUp 0.25s ease-out',
        'pulse-ring': 'pulseRing 1.5s ease-out infinite',
        'ring': 'ring 1s ease-in-out infinite',
      },
      keyframes: {
        scaleIn: { '0%': { transform: 'scale(0.95)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(100%)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        pulseRing: { '0%': { transform: 'scale(1)', opacity: '1' }, '100%': { transform: 'scale(1.5)', opacity: '0' } },
        ring: { '0%, 100%': { transform: 'rotate(0deg)' }, '10%, 30%': { transform: 'rotate(-15deg)' }, '20%, 40%': { transform: 'rotate(15deg)' } },
      },
    },
  },
  plugins: [],
}
