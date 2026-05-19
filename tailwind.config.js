import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './views/**/*.{hbs,html,js}',
    './public/**/*.{html,js}',
    './platonportal.js',
    './index.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [forms],
};
