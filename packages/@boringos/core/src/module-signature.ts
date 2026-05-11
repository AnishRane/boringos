// SPDX-License-Identifier: MIT
//
// module-signature — Ed25519 signature verification for `.hebbsmod`
// bundles.
//
// Called from the upload route (`POST /api/admin/modules/upload`)
// after a bundle has been extracted to a temporary directory and
// before the framework atomic-moves it into the package store.
//
// Spec: docs/install-flow.md §1.1 (bundle internals) + §1.4 +
// docs/blockers/task_22_module_packages_upload_install.md U3.4.
//
// Design notes:
//   - The signed payload is the byte concatenation of
//       module.json + index.mjs + ui/index.mjs (if present)
//     read from the extracted directory. Authors compute the same
//     payload (see sign-hebbsmod CLI) and produce a 64-byte raw
//     Ed25519 detached signature stored as `<bundle>/signature`.
//   - Sidecar metadata `<bundle>/signature.meta.json` carries the
//     publisher id so the verifier knows which key to load from the
//     host's trust list.
//   - Trusted publisher keys are 32-byte raw Ed25519 public keys,
//     hex-encoded in the host's `module-publishers.json` (or the
//     `HEBBS_MODULE_PUBLISHERS` env var). The verifier wraps each
//     into a DER-SPKI structure so Node's `crypto.createPublicKey`
//     accepts them — Node has no first-class "raw 32-byte ed25519"
//     loader, but the SPKI prefix is fixed and well-known.
//   - When `opts.allowUnsigned` is true (host running with
//     `HEBBS_DEV_MODULES=true`), a missing `signature` file is
//     accepted with `reason: "unsigned-accepted-dev-mode"` so local
//     development works without keypair ceremony.

import {
  createPublicKey,
  type KeyObject,
  verify as cryptoVerify,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PublisherKey {
  /** Stable id — used in module.json `publisher.id` + signature.meta.json. */
  id: string;
  /** Display name shown next to the signature-verified checkmark. */
  name: string;
  /** Hex-encoded raw Ed25519 32-byte public key (64 hex chars). */
  publicKey: string;
}

export interface SignatureVerifyResult {
  ok: boolean;
  /** Human-readable failure reason, also set on some success paths. */
  reason?: string;
  /** Resolved publisher id, or null when no signature was processed. */
  publisherId: string | null;
  /** Display name from the trust list (only on success with a key). */
  publisherName?: string;
}

export interface VerifyOptions {
  /**
   * If true and the bundle has no `signature` file, accept it.
   * Wired to `HEBBS_DEV_MODULES === "true"` at the caller.
   */
  allowUnsigned?: boolean;
  /**
   * Trusted publishers; defaults to `loadTrustedPublishers()`.
   * Tests pass this explicitly to avoid touching disk.
   */
  trustedPublishers?: PublisherKey[];
}

interface SignatureMeta {
  publisherId: string;
  algorithm: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * DER-SPKI prefix for an Ed25519 public key.
 *
 *   30 2a            SEQUENCE (42 bytes)
 *     30 05          SEQUENCE (5 bytes)   -- AlgorithmIdentifier
 *       06 03 2b 65 70   OID 1.3.101.112  (id-Ed25519, RFC 8410)
 *     03 21 00       BIT STRING (33 bytes, 0 unused) introducer
 *
 * The full SPKI is `prefix (12 bytes) || rawPubKey (32 bytes)` = 44 bytes.
 * Node's `crypto.createPublicKey` consumes that buffer directly with
 * `{ format: "der", type: "spki" }`.
 */
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

const RAW_ED25519_KEY_LEN = 32;
const RAW_ED25519_SIG_LEN = 64;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rawHexToSpkiKeyObject(publicKeyHex: string): KeyObject {
  const raw = Buffer.from(publicKeyHex, "hex");
  if (raw.length !== RAW_ED25519_KEY_LEN) {
    throw new Error(
      `Ed25519 public key must be ${RAW_ED25519_KEY_LEN} bytes (got ${raw.length}). ` +
        `Expected ${RAW_ED25519_KEY_LEN * 2} hex chars.`,
    );
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

function readFileIfExists(path: string): Buffer | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

function buildSignedPayload(extractedDir: string): Buffer | null {
  const moduleJson = readFileIfExists(resolvePath(extractedDir, "module.json"));
  const indexMjs = readFileIfExists(resolvePath(extractedDir, "index.mjs"));
  if (!moduleJson || !indexMjs) {
    // Caller is responsible for manifest validation; we return null so
    // the verifier can short-circuit with a clear reason.
    return null;
  }
  const uiIndex = readFileIfExists(resolvePath(extractedDir, "ui/index.mjs"));
  const parts: Buffer[] = [moduleJson, indexMjs];
  if (uiIndex) parts.push(uiIndex);
  return Buffer.concat(parts);
}

function parseSignatureMeta(raw: Buffer): SignatureMeta | null {
  try {
    const obj = JSON.parse(raw.toString("utf8")) as Partial<SignatureMeta>;
    if (typeof obj.publisherId !== "string" || obj.publisherId.length === 0) {
      return null;
    }
    if (typeof obj.algorithm !== "string" || obj.algorithm.length === 0) {
      return null;
    }
    return { publisherId: obj.publisherId, algorithm: obj.algorithm };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify the detached Ed25519 signature inside an extracted `.hebbsmod`.
 *
 * The result always carries `publisherId` (or null). Callers persist
 * `publisherId` into `module_packages.signaturePublisherId`.
 */
export function verifyModuleSignature(
  extractedDir: string,
  opts: VerifyOptions = {},
): SignatureVerifyResult {
  const sigPath = resolvePath(extractedDir, "signature");
  const metaPath = resolvePath(extractedDir, "signature.meta.json");

  const sigBytes = readFileIfExists(sigPath);

  // (1) No signature file present.
  if (!sigBytes) {
    if (opts.allowUnsigned === true) {
      return {
        ok: true,
        reason: "unsigned-accepted-dev-mode",
        publisherId: null,
      };
    }
    return {
      ok: false,
      reason: "missing-signature",
      publisherId: null,
    };
  }

  // (2) Signature meta sidecar must be present + well-formed.
  const metaBytes = readFileIfExists(metaPath);
  if (!metaBytes) {
    return {
      ok: false,
      reason: "missing-signature-meta",
      publisherId: null,
    };
  }
  const meta = parseSignatureMeta(metaBytes);
  if (!meta) {
    return {
      ok: false,
      reason: "invalid-signature-meta",
      publisherId: null,
    };
  }
  if (meta.algorithm !== "ed25519") {
    return {
      ok: false,
      reason: "unsupported-signature-algorithm",
      publisherId: meta.publisherId,
    };
  }

  // (3) Locate the publisher in the trust list.
  const trusted = opts.trustedPublishers ?? loadTrustedPublishers();
  const publisher = trusted.find((p) => p.id === meta.publisherId);
  if (!publisher) {
    return {
      ok: false,
      reason: "unknown-publisher",
      publisherId: meta.publisherId,
    };
  }

  // (4) Reject obviously malformed signatures up front. Node's
  // `crypto.verify` would also reject, but a length check gives a
  // crisper error and avoids burning a public-key construction on
  // garbage input.
  if (sigBytes.length !== RAW_ED25519_SIG_LEN) {
    return {
      ok: false,
      reason: "invalid-signature",
      publisherId: meta.publisherId,
    };
  }

  // (5) Build the signed payload from the bundle bytes.
  const payload = buildSignedPayload(extractedDir);
  if (!payload) {
    return {
      ok: false,
      reason: "missing-signed-files",
      publisherId: meta.publisherId,
    };
  }

  // (6) Run the verification. Ed25519 in Node uses `algorithm = null`.
  let key: KeyObject;
  try {
    key = rawHexToSpkiKeyObject(publisher.publicKey);
  } catch {
    return {
      ok: false,
      reason: "invalid-publisher-key",
      publisherId: meta.publisherId,
    };
  }

  let valid: boolean;
  try {
    valid = cryptoVerify(null, payload, key, sigBytes);
  } catch {
    valid = false;
  }

  if (!valid) {
    return {
      ok: false,
      reason: "invalid-signature",
      publisherId: meta.publisherId,
    };
  }

  return {
    ok: true,
    publisherId: publisher.id,
    publisherName: publisher.name,
  };
}

// ---------------------------------------------------------------------------
// Trust list loader
// ---------------------------------------------------------------------------

/**
 * Load the host's trusted publisher list.
 *
 * Precedence (first non-empty source wins):
 *   1. `HEBBS_MODULE_PUBLISHERS` env var, a JSON array.
 *   2. `<cwd>/.data/module-publishers.json`, same JSON shape.
 *
 * Returns `[]` if neither is set. The env var wins because it's the
 * easier surface for transient overrides (CI, containers) and for
 * one-off "trust this key for an evening" workflows.
 */
export function loadTrustedPublishers(): PublisherKey[] {
  const envRaw = process.env.HEBBS_MODULE_PUBLISHERS;
  if (envRaw && envRaw.trim().length > 0) {
    const parsed = safeParsePublisherList(envRaw, "HEBBS_MODULE_PUBLISHERS env");
    if (parsed) return parsed;
    // Fall through to file on parse error so a botched env var doesn't
    // silently wipe the trust list — but only after warning.
  }

  const filePath = resolvePath(process.cwd(), ".data", "module-publishers.json");
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = safeParsePublisherList(raw, filePath);
      if (parsed) return parsed;
    } catch (err) {
      process.stderr.write(
        `[module-signature] failed to read ${filePath}: ${(err as Error).message}\n`,
      );
    }
  }

  return [];
}

function safeParsePublisherList(
  raw: string,
  source: string,
): PublisherKey[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[module-signature] could not parse publisher list from ${source}: ${(err as Error).message}\n`,
    );
    return null;
  }
  if (!Array.isArray(parsed)) {
    process.stderr.write(
      `[module-signature] publisher list from ${source} must be a JSON array.\n`,
    );
    return null;
  }
  const out: PublisherKey[] = [];
  for (const entry of parsed) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      typeof (entry as Record<string, unknown>).name === "string" &&
      typeof (entry as Record<string, unknown>).publicKey === "string"
    ) {
      out.push({
        id: (entry as { id: string }).id,
        name: (entry as { name: string }).name,
        publicKey: (entry as { publicKey: string }).publicKey,
      });
    } else {
      process.stderr.write(
        `[module-signature] skipping malformed entry in ${source}\n`,
      );
    }
  }
  return out;
}
