import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', '.vercel/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Formatting is not this linter's job; keep Vue's layout rules quiet.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
    },
  },
  {
    // Layer rules from docs/architecture.md, enforced rather than remembered.
    files: ['src/orbital/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vue', message: 'src/orbital must stay pure TypeScript.' },
            { name: 'three', message: 'src/orbital must stay pure TypeScript.' },
          ],
          patterns: [
            { group: ['three/*', '**/three/*', '**/components/*', '**/composables/*'], message: 'src/orbital must stay pure TypeScript.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/three/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'vue', message: 'src/three never imports Vue.' }] },
      ],
    },
  },
)
