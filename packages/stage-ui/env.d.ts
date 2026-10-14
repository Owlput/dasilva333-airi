/// <reference types="@histoire/plugin-vue/components.d.ts" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '*.avif' {
  const src: string
  export default src
}
