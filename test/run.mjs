import esbuild from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

// 순수 함수만 테스트한다 (vscode 모듈 없음). test/*.test.ts를 번들해 node --test로 돌린다
// node --test는 node_modules 아래 경로를 건너뛰어서 OS 임시 폴더에 낸다
const outdir = path.join(tmpdir(), "anchor-notes-test");
const entries = readdirSync("test").filter((name) => name.endsWith(".test.ts"));

rmSync(outdir, { recursive: true, force: true });
await esbuild.build({
  entryPoints: entries.map((name) => path.join("test", name)),
  outdir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  packages: "external",
  logLevel: "warning",
});

const files = entries.map((name) => path.join(outdir, name.replace(/\.ts$/, ".mjs")));
const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
