import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'acceptance/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['{shared,server,desktop,examples}/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
);
