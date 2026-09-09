import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// WSL2 + /mnt/c(윈도우 파일시스템)에서는 inotify 이벤트가 발생하지 않아 HMR 이 동작하지 않는다.
// usePolling 으로 폴링 감시를 켜야 소스 변경이 Vite 에 반영된다.
export default defineConfig({ plugins: [react()], server: { watch: { usePolling: true, interval: 300 } }, build: { outDir: 'dist/client', emptyOutDir: true } });
