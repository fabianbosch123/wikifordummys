import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', '**/playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // S9: keine rohen SQL-Abfragen mit String-Verkettung
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Nur parametrisierte Abfragen ($queryRaw mit Template) verwenden.' },
        { property: '$executeRawUnsafe', message: 'Nur parametrisierte Abfragen ($executeRaw mit Template) verwenden.' },
      ],
      // S6: kein ungefiltertes HTML im Frontend
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML ist verboten (S6).' },
      ],
    },
  },
);
