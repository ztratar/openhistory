import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared")
      }
    }
  },
  renderer: {
    root: resolve("src/renderer"),
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [react()]
  }
});
