import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig(({command})=>({
  root:fileURLToPath(new URL('./pages',import.meta.url)),
  base:command==='serve'?'/':process.env.PAGES_BASE_PATH??'/role-da-extensao-proex-ufg/',
  publicDir:fileURLToPath(new URL('./public',import.meta.url)),
  plugins:[react()],
  resolve:{alias:{'@':root}},
  css:{postcss:root},
  build:{outDir:fileURLToPath(new URL('./dist-pages',import.meta.url)),emptyOutDir:true},
}));
