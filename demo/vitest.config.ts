import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // Evaluation snapshots are immutable evidence, not additional test suites.
    exclude: [...configDefaults.exclude, '**/.e2e/**'],
  },
}));
