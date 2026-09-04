import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: ['.next/**', 'node_modules/**', 'backEnd/**', 'wwebjs-service/**', '.claude/**'],
  },
  {
    // These two "React Compiler readiness" rules flag long-standing, working
    // patterns in this codebase (setState in useEffect, reading ref.current
    // during render) as hard errors — real for compiler-memoized code, not
    // for this app. Downgraded to warnings so `npm run lint` stays useful
    // instead of drowning in ~180 non-bugs.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      // "Compilation Skipped: existing memoization could not be preserved" — advisory
      // only: React Compiler declines to auto-optimize the component further, but the
      // developer's own useMemo/useCallback keeps working exactly as written. Not a
      // functional bug.
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]

export default eslintConfig
