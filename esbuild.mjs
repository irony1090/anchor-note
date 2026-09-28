import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// 확장 호스트는 Node에서 돌고, vscode 모듈은 런타임이 주입하므로 번들에 넣으면 안 된다
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

// 웹뷰 entry. 출력은 dist/{key}.js
const webviewEntries = { "note-editor": "webview/note-editor.ts", browse: "webview/browse.ts" };

// 웹뷰는 브라우저에서 돌고 <script type="module">로 실려서 esm이어야 한다
const webviewConfig = {
  entryPoints: webviewEntries,
  outdir: "dist",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const configs = [extensionConfig];
if (Object.keys(webviewEntries).length > 0) configs.push(webviewConfig);

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("[anchor-notes] watching...");
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log("[anchor-notes] build done");
}
