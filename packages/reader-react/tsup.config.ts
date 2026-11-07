import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    reader: 'src/reader.tsx',
    primitives: 'src/primitives.tsx',
    gsap: 'src/gsap-adapter.ts',
  },
  format: ['esm'],
  dts: { compilerOptions: { composite: false, incremental: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'porejs', 'porejs/internal', 'gsap'],
});
