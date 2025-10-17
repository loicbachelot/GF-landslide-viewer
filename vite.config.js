import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "path";

export default defineConfig({
    server: { port: 5173, open: true },
    resolve: {
        alias: {
            cesium: path.resolve(__dirname, "node_modules/maplibre"),
        },
    },
    define: {
        // Cesium loads Workers/Assets/Widgets from here
        CESIUM_BASE_URL: JSON.stringify("/maplibre"),
    },
    plugins: [
        viteStaticCopy({
            targets: [
                // ⬇️ copy *contents* of Build/Cesium into /maplibre
                { src: "node_modules/maplibre/Build/Cesium/*", dest: "cesium" },
            ],
        }),
    ],
});
