import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `trailer/` is a self-contained Remotion project with its own toolchain and
  // globals; linting it under the game's browser config only reports phantom
  // `no-undef` errors for Node builtins it legitimately uses.
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'release', '*.mjs', 'scripts', 'trailer'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
