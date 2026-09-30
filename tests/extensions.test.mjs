import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));

// A leftover discoverable extension would register removed commands/tools even
// when the installer and UI no longer advertise them.
test("discoverable extensions do not register the removed mode workflow", async () => {
  const extensionDir = join(root, "agent", "extensions");
  const entries = await readdir(extensionDir, { withFileTypes: true });
  const paths = entries.filter((entry) => entry.isDirectory())
    .map((entry) => join(extensionDir, entry.name, "index.ts"));
  const loaded = await loadExtensions(paths, root);
  assert.deepEqual(loaded.errors, []);
  const commands = loaded.extensions.flatMap((extension) => [...extension.commands.keys()]);
  const tools = loaded.extensions.flatMap((extension) => [...extension.tools.keys()]);
  const flags = loaded.extensions.flatMap((extension) => [...extension.flags.keys()]);
  assert.equal(commands.includes("chat"), false);
  assert.equal(commands.includes("plan"), false);
  assert.equal(tools.includes("plan_complete"), false);
  assert.equal(flags.includes("chat"), false);
  assert.equal(flags.includes("plan"), false);
  assert.ok(tools.includes("artifact"), "the artifact tool remains available");
  assert.ok(tools.includes("read"), "styled native tools remain available");
});
