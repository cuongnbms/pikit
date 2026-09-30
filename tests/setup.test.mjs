import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../setup.sh", import.meta.url));

async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), "pikit-setup-"));
  try {
    await run(home, (...args) => spawnSync("bash", [script, ...args], {
      env: { ...process.env, HOME: home }, encoding: "utf8",
    }));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

// Reintroducing the removed setup job would create presets or overwrite a user's
// historical config. Exercise the real script against an isolated HOME.
test("default setup syncs supported files without installing mode presets", async () => {
  await withHome(async (home, setup) => {
    const agent = join(home, ".pi", "agent");
    const configs = join(agent, "configs");
    await mkdir(configs, { recursive: true });
    const legacyPath = join(configs, "chat-mode.json");
    const legacy = '{"userOwned":true}\n';
    await writeFile(legacyPath, legacy);

    assertSuccess(setup());
    assert.deepEqual(await readdir(configs), ["chat-mode.json"]);
    assert.equal(await readFile(legacyPath, "utf8"), legacy);
    const settings = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
    assert.equal(settings.theme, "slop");
    assert.equal(settings.quietStartup, true);
    const keybindings = JSON.parse(await readFile(join(agent, "keybindings.json"), "utf8"));
    assert.equal(keybindings["app.model.cycleForward"], "ctrl+shift+m");
    assert.equal(keybindings["app.thinking.cycle"], "ctrl+shift+t");
    assert.match(await readFile(join(agent, "APPEND_SYSTEM.md"), "utf8"), /\S/);

    const repeat = setup();
    assertSuccess(repeat);
    assert.match(repeat.stdout, /nothing to do/);
    assert.deepEqual(await readdir(configs), ["chat-mode.json"]);
    assert.equal(await readFile(legacyPath, "utf8"), legacy);
  });
});

test("removed modes flag is rejected rather than restoring presets", async () => {
  await withHome(async (_home, setup) => {
    const result = setup("--modes");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown flag: --modes/);
  });
});
