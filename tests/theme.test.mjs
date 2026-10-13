import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Same host override as the renderer tests, so a newer Pi can be checked without changing deps.
const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const themePath = fileURLToPath(new URL("../agent/themes/slop.json", import.meta.url));

// Pi validates themes at startup (1.2.0+) and rejects colors outside its token list.
test("slop theme only defines colors Pi's theme schema accepts", async () => {
  const { THEME_TOKENS } = await import(pathToFileURL(join(piDir, "dist/modes/interactive/theme/theme-tokens.js")));
  const tokens = new Set(Object.keys(THEME_TOKENS));
  const theme = JSON.parse(await readFile(themePath, "utf8"));
  const unknown = Object.keys(theme.colors).filter((name) => !tokens.has(name));
  assert.deepEqual(unknown, []);
});
