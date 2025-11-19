import {defineConfig} from "vite";

export default defineConfig({
    server: {
        port: 5173, open: true,
        proxy: {
            '/api': {
                target: 'http://localhost:8001',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
        },
    },
});
