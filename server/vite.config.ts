import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Bundles the gateway into one self-contained ESM file (zod inlined) so the
// runtime image needs no node_modules.
const here = import.meta.dirname

export default defineConfig({
  build: {
    ssr: resolve(here, 'src/index.ts'),
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'node:sqlite'],
      output: { format: 'es', entryFileNames: 'index.mjs' }
    }
  },
  ssr: { noExternal: true, target: 'node' }
})
