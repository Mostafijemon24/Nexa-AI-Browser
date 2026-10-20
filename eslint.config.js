// NEXA ESLint flat config (ESLint 9 + typescript-eslint 8 + react-hooks).
// Philosophy: correctness, security, unused-code, TypeScript/React correctness.
// Minimal stylistic rules — formatting is intentionally NOT enforced here to
// avoid noisy, unrelated diffs. Target: 0 errors.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'server/dist/**',
      'node_modules/**',
      'coverage/**',
      '**/*.tsbuildinfo',
      // Test extension fixture ships plain browser scripts, not part of the app.
      'test-extension/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 }
    },
    rules: {
      // tsc owns undefined-symbol + redeclaration checking for TS.
      'no-undef': 'off',
      'no-redeclare': 'off',
      // Prefer the TS-aware unused-vars rule; allow intentional `_`-prefixed args.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      // Structural typing in the codebase uses `{}`/interfaces intentionally.
      '@typescript-eslint/no-empty-object-type': 'off'
    }
  },
  {
    // Renderer: React Hooks correctness.
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    // Tests deliberately use dynamic require() to load fresh module instances
    // and to exercise isolate/reset behavior.
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  }
)
