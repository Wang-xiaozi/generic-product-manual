import vue from 'eslint-plugin-vue'

const asWarning = (setting) => {
  if (setting === 0 || (Array.isArray(setting) && setting[0] === 0)) return setting
  return Array.isArray(setting) ? ['warn', ...setting.slice(1)] : 'warn'
}

const vueRules = vue.configs['flat/essential'].map((config) => ({
  ...config,
  rules: Object.fromEntries(
    Object.entries(config.rules || {}).map(([name, setting]) => [name, asWarning(setting)]),
  ),
}))

export default [
  {
    ignores: [
      'public/_thirdparty/**',
      'public/vendor/**',
      'dist/**',
      'node_modules/**',
      'src/components/product-manual/_thirdparty/**',
    ],
  },
  ...vueRules,
  { files: ['src/**/*.js'], rules: { 'no-unused-vars': 'warn' } },
]
