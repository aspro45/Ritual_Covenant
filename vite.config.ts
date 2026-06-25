import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2300,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.message.includes("#__PURE__") && warning.message.includes("node_modules")) {
          return;
        }

        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react-vendor";
          }

          if (
            id.includes("node_modules/@rainbow-me") ||
            id.includes("node_modules/@tanstack") ||
            id.includes("node_modules/@walletconnect") ||
            id.includes("node_modules/@reown") ||
            id.includes("node_modules/@coinbase") ||
            id.includes("node_modules/@base-org") ||
            id.includes("node_modules/wagmi") ||
            id.includes("node_modules/viem") ||
            id.includes("node_modules/porto") ||
            id.includes("node_modules/ox")
          ) {
            return "wallet-vendor";
          }

          if (id.includes("node_modules/@react-three") || id.includes("node_modules/three")) {
            return "scene-vendor";
          }

          if (id.includes("node_modules/lucide-react")) {
            return "icons-vendor";
          }

          return undefined;
        },
      },
    },
  },
});
