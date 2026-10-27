/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: "#0b1120",
        panelBg: "#111827",
        cardBg: "#1e293b",
        borderDark: "#334155",
      },
    },
  },
  plugins: [],
}
