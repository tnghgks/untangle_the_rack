import { defineConfig } from 'vitest/config';

// GitHub Pages는 https://tnghgks.github.io/untangle_the_rack/ 하위 경로에서 서빙
export default defineConfig({
  base: '/untangle_the_rack/',
  // three.js 단일 번들이 ~560kB라 기본 경고 기준(500kB)을 넘는다
  build: { chunkSizeWarningLimit: 800 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
