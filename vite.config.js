import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        signup: resolve(__dirname, "signup/index.html"),
        mypage: resolve(__dirname, "mypage/index.html"),
        story: resolve(__dirname, "story/index.html"),
        scoring: resolve(__dirname, "scoring/index.html"),
        bestMeals: resolve(__dirname, "best-meals/index.html"),
        discussion: resolve(__dirname, "discussion/index.html"),
      },
    },
  },
});
