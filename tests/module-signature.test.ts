// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit coverage for the Ed25519 signature verifier used by the
// `.hebbsmod` upload route (task_22 U3.4).
//
// We test against the public API in @boringos/core. The verifier is
// pure-Node + filesystem — no DB / no HTTP / no Hono — so each
// scenario is a fresh tempdir with hand-written bytes.

import {
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadTrustedPublishers,
  verifyModuleSignature,
  type PublisherKey,
} from "@boringos/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh extracted-bundle directory with module.json + index.mjs
 * (and optionally ui/index.mjs). Returns the directory.
 */
function makeExtractedDir(opts?: {
  withUi?: boolean;
  indexMjsContent?: string;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "module-signature-test-"));
  writeFileSync(
    join(dir, "module.json"),
    JSON.stringify({ id: "test", version: "0.1.0", kind: "module" }, null, 2),
  );
  writeFileSync(
    join(dir, "index.mjs"),
    opts?.indexMjsContent ?? "export default { id: 'test' };\n",
  );
  if (opts?.withUi) {
    mkdirSync(join(dir, "ui"), { recursive: true });
    writeFileSync(join(dir, "ui/index.mjs"), "export const Panel = () => null;\n");
  }
  return dir;
}

/**
 * Produce a fresh Ed25519 keypair and return:
 *   - the raw 32-byte public key in hex (for PublisherKey.publicKey)
 *   - a `sign(payload)` helper bound to the matching private key
 */
function makeKeypair(): {
  publicHex: string;
  sign: (payload: Buffer) => Buffer;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const publicRaw = publicDer.subarray(publicDer.length - 32);
  return {
    publicHex: Buffer.from(publicRaw).toString("hex"),
    sign: (payload: Buffer) => cryptoSign(null, payload, privateKey),
  };
}

/**
 * Concatenate module.json + index.mjs + ui/index.mjs (if present) the
 * same way the verifier does — kept in lockstep with module-signature.ts.
 */
function readPayload(dir: string, withUi: boolean): Buffer {
  const moduleJson = readFileSync(join(dir, "module.json"));
  const indexMjs = readFileSync(join(dir, "index.mjs"));
  if (withUi) {
    const uiIndex = readFileSync(join(dir, "ui/index.mjs"));
    return Buffer.concat([moduleJson, indexMjs, uiIndex]);
  }
  return Buffer.concat([moduleJson, indexMjs]);
}

function writeSignature(dir: string, sig: Buffer, publisherId: string): void {
  writeFileSync(join(dir, "signature"), sig);
  writeFileSync(
    join(dir, "signature.meta.json"),
    JSON.stringify({ publisherId, algorithm: "ed25519" }, null, 2),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyModuleSignature", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop();
      if (d) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("accepts a valid signature from a trusted publisher", () => {
    const dir = makeExtractedDir({ withUi: true });
    dirs.push(dir);

    const { publicHex, sign } = makeKeypair();
    const payload = readPayload(dir, true);
    const sig = sign(payload);
    writeSignature(dir, sig, "test-publisher");

    const trustedPublishers: PublisherKey[] = [
      { id: "test-publisher", name: "Test Publisher", publicKey: publicHex },
    ];

    const result = verifyModuleSignature(dir, { trustedPublishers });
    expect(result.ok).toBe(true);
    expect(result.publisherId).toBe("test-publisher");
    expect(result.publisherName).toBe("Test Publisher");
  });

  it("rejects a signature when index.mjs is tampered after signing", () => {
    const dir = makeExtractedDir();
    dirs.push(dir);

    const { publicHex, sign } = makeKeypair();
    const payload = readPayload(dir, false);
    const sig = sign(payload);
    writeSignature(dir, sig, "test-publisher");

    // Tamper: append a single byte to index.mjs.
    appendFileSync(join(dir, "index.mjs"), "// tampered\n");

    const trustedPublishers: PublisherKey[] = [
      { id: "test-publisher", name: "Test Publisher", publicKey: publicHex },
    ];

    const result = verifyModuleSignature(dir, { trustedPublishers });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid-signature");
    expect(result.publisherId).toBe("test-publisher");
  });

  it("rejects a signature from an unknown publisher", () => {
    const dir = makeExtractedDir();
    dirs.push(dir);

    const { sign } = makeKeypair();
    const payload = readPayload(dir, false);
    const sig = sign(payload);
    writeSignature(dir, sig, "stranger");

    const trustedPublishers: PublisherKey[] = []; // empty trust list

    const result = verifyModuleSignature(dir, { trustedPublishers });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown-publisher");
    expect(result.publisherId).toBe("stranger");
  });

  it("rejects an unsigned bundle when allowUnsigned is false", () => {
    const dir = makeExtractedDir();
    dirs.push(dir);

    const result = verifyModuleSignature(dir, {
      allowUnsigned: false,
      trustedPublishers: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-signature");
    expect(result.publisherId).toBe(null);
  });

  it("accepts an unsigned bundle when allowUnsigned is true (dev mode)", () => {
    const dir = makeExtractedDir();
    dirs.push(dir);

    const result = verifyModuleSignature(dir, {
      allowUnsigned: true,
      trustedPublishers: [],
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("unsigned-accepted-dev-mode");
    expect(result.publisherId).toBe(null);
  });

  it("rejects when signature.meta.json is missing", () => {
    const dir = makeExtractedDir();
    dirs.push(dir);

    const { publicHex, sign } = makeKeypair();
    const payload = readPayload(dir, false);
    const sig = sign(payload);
    // Only write the raw signature, omit the sidecar.
    writeFileSync(join(dir, "signature"), sig);

    const trustedPublishers: PublisherKey[] = [
      { id: "test-publisher", name: "Test Publisher", publicKey: publicHex },
    ];

    const result = verifyModuleSignature(dir, { trustedPublishers });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-signature-meta");
    expect(result.publisherId).toBe(null);
  });
});

describe("loadTrustedPublishers", () => {
  const savedEnv = process.env.HEBBS_MODULE_PUBLISHERS;

  beforeEach(() => {
    delete process.env.HEBBS_MODULE_PUBLISHERS;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.HEBBS_MODULE_PUBLISHERS;
    } else {
      process.env.HEBBS_MODULE_PUBLISHERS = savedEnv;
    }
  });

  it("parses the HEBBS_MODULE_PUBLISHERS env var", () => {
    process.env.HEBBS_MODULE_PUBLISHERS = JSON.stringify([
      {
        id: "hebbs",
        name: "Hebbs Inc.",
        publicKey: "ab".repeat(32),
      },
    ]);
    const list = loadTrustedPublishers();
    expect(list).toEqual([
      { id: "hebbs", name: "Hebbs Inc.", publicKey: "ab".repeat(32) },
    ]);
  });

  it("returns [] when nothing is configured", () => {
    // cwd is repo root for vitest; ensure no .data/module-publishers.json
    // leaks in. The repo doesn't ship that file by default.
    const cwdFile = join(process.cwd(), ".data", "module-publishers.json");
    if (existsSync(cwdFile)) {
      // Don't touch a real publisher list — skip this scenario.
      return;
    }
    const list = loadTrustedPublishers();
    expect(list).toEqual([]);
  });
});
