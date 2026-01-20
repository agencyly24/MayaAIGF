import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    define: {
      // This ensures process.env.API_KEY is replaced by the actual string during build
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      // Prevents "process is not defined" error in browser
      'process.env': {},
    },
  };
});