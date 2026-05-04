// Tailwind 4 ships its own PostCSS plugin (split out of the main package)
// and bundles vendor-prefixing via Lightning CSS — autoprefixer no longer
// needed.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
