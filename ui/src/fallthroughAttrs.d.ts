/**
 * Fallthrough attributes every component may receive on its root element.
 *
 * `vueCompilerOptions.checkUnknownProps` / `checkUnknownEvents` (tsconfig.json)
 * make vue-tsc reject props and `@event` handlers a component does not
 * declare, so a renamed prop or event (for example on ModelCard / ModelRow)
 * fails the type check. Accessibility and data attributes and a native click
 * listener (e.g. on RouterLink) are legitimate fallthrough attributes, so they
 * are allowed here explicitly. Anything else still has to be declared.
 */
export {}

declare module 'vue' {
  interface ComponentCustomProps {
    [ariaAttribute: `aria-${string}`]: unknown
    [dataAttribute: `data-${string}`]: unknown
    /** `:data-x="..."` bindings reach the props object camelized (`dataX`). */
    [boundDataAttribute: `data${Capitalize<string>}`]: unknown
    title?: string
    onClick?: (event: MouseEvent) => void
  }
}
