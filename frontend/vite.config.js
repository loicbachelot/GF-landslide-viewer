import {defineConfig} from "vite";

export default defineConfig({
    server: {
        port: 5173, open: true,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
        },
    },
});
