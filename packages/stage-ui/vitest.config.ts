import type { Plugin } from 'vite'

import { join, resolve } from 'node:path'
import { cwd } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  return ({
    plugins: [
      Vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag: string) => tag.startsWith('Tres') && tag !== 'TresCanvas',
          },
        },
      }),
      Info(),
      Yaml() as Plugin,
    ],
    resolve: {
      alias: {
        '@lemonneko/crop-empty-pixels': resolve(import.meta.dirname, '../../node_modules/@lemonneko/crop-empty-pixels/dist/index.js'),
        '@proj-airi/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
        '@proj-airi/stage-shared': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-shared', 'src')),
        // The model-driver host this package's `libs/model-drivers` is written against. Aliased to source for the
        // same reason the app aliases it: the SDK is source-only and private, so there is no built artifact to
        // resolve. The `/host` entry has to be matched before the package root.
        '@proj-airi/stage-renderer-sdk/host': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-renderer-sdk', 'src', 'host', 'index.ts')),
        '@proj-airi/stage-renderer-sdk': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-renderer-sdk', 'src', 'index.ts')),
      },
    },
    test: {
      include: ['src/**/*.test.ts'],
      setupFiles: [resolve(import.meta.dirname, 'vitest.setup.ts')],
      env: loadEnv(mode, join(cwd(), 'packages', 'stage-ui'), ''),
    },
  })
})
