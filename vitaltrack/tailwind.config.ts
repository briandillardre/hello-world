import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vital: {
          50: "#effdf9",
          100: "#c9f7eb",
          500: "#0d9488",
          600: "#0f766e",
          700: "#115e59",
          900: "#134e4a",
        },
      },
    },
  },
  plugins: [],
};
export default config;
