import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// 命令行测试每条都要起 node + tsx，慢一点。叫 .spec.ts 是为了不被 claude plugin test 当成面板的测试。
// CHIEF_HOME 指到临时目录：在测试进程里直接调的函数（读 config.json 之类）也碰不到你真的 ~/chief。
export default defineConfig({ test: { include: ["test/**/*.spec.ts"], testTimeout: 30_000, env: { CHIEF_HOME: mkdtempSync(join(tmpdir(), "chief-vitest-")) } } });
