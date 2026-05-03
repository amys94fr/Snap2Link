/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: {
          950: "#0f172a",
          900: "#1e293b",
          800: "#334155",
        },
        brand: {
          DEFAULT: "#3B82F6",
          dark: "#2563EB",
        },
        success: "#22C55E",
        danger: "#EF4444",
      },
      fontFamily: {
        sans: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["Consolas", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
