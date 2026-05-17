#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// sign-hebbsmod — produce + attach a detached Ed25519 signature
// for a `.hebbsmod` bundle (or a packed directory) so the host's
// signature verifier (packages/@boringos/core/src/module-signature.ts)
// accepts it in production mode.
//
// Usage:
//   sign-hebbsmod --gen-key
//      Generate a fresh Ed25519 keypair and print both halves as
//      raw 32-byte hex. Author copies the public half into the host's
//      `.data/module-publishers.json`; private half stays secret.
//
//   sign-hebbsmod \
//     --pkg <packed-dir-or-.hebbsmod> \
//     --key <private-key-hex> \
//     --publisher-id <id>
//        Sign the concat of `module.json` + `index.mjs` +
//        `ui/index.mjs` (if present) with the private key. If the
//        input is a `.hebbsmod` zip, the CLI extracts it, drops in
//        `signature` + `signature.meta.json`, and rewrites the zip
//        in place. If the input is a directory, the signature files
//        land alongside `module.json`.
//
// The signed payload byte-order MUST stay identical to what
// verifyModuleSignature() reads. Any change here is a breaking
// protocol change.

import archiver from "archiver";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import yauzl from "yauzl";

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

interface CliArgs {
  pkg: string | null;
  privateKeyHex: string | null;
  publisherId: string | null;
  genKey: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    pkg: null,
    privateKeyHex: null,
    publisherId: null,
    genKey: false,
    help: false,
  };

  const takeNext = (i: number, flag: string): string => {
    const next = argv[i + 1];
    if (!next) throw new Error(`${flag} requires an argument`);
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--gen-key") {
      args.genKey = true;
    } else if (a === "--pkg") {
      args.pkg = resolvePath(takeNext(i, "--pkg"));
      i++;
    } else if (a && a.startsWith("--pkg=")) {
      args.pkg = resolvePath(a.slice("--pkg=".length));
    } else if (a === "--key") {
      args.privateKeyHex = takeNext(i, "--key");
      i++;
    } else if (a && a.startsWith("--key=")) {
      args.privateKeyHex = a.slice("--key=".length);
    } else if (a === "--publisher-id") {
      args.publisherId = takeNext(i, "--publisher-id");
      i++;
    } else if (a && a.startsWith("--publisher-id=")) {
      args.publisherId = a.slice("--publisher-id=".length);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      "sign-hebbsmod — attach an Ed25519 signature to a .hebbsmod bundle",
      "",
      "Usage:",
      "  sign-hebbsmod --gen-key",
      "  sign-hebbsmod --pkg <path> --key <private-hex> --publisher-id <id>",
      "",
      "Options:",
      "  --gen-key          Generate a fresh Ed25519 keypair and exit",
      "  --pkg <path>       .hebbsmod zip OR packed directory to sign",
      "  --key <hex>        Private key, raw 32-byte hex (no 0x prefix)",
      "  --publisher-id <id>  Publisher id recorded in signature.meta.json",
      "  -h, --help         Show this help",
      "",
      "Signed payload (byte order, must stay stable):",
      "  module.json + index.mjs + ui/index.mjs (if present)",
      "",
      "Output:",
      "  signature              raw 64-byte Ed25519 detached signature",
      "  signature.meta.json    { publisherId, algorithm: \"ed25519\" }",
      "",
      "For .hebbsmod input, the zip is rewritten in place with the new",
      "signature files added.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Keypair helpers
// ---------------------------------------------------------------------------

const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/**
 * PKCS8 prefix for an Ed25519 *private* key.
 *
 *   30 2e            SEQUENCE (46 bytes)
 *     02 01 00       INTEGER 0  (version)
 *     30 05          SEQUENCE (5 bytes) AlgorithmIdentifier
 *       06 03 2b 65 70  OID id-Ed25519
 *     04 22          OCTET STRING (34 bytes)
 *       04 20        nested OCTET STRING (32 bytes) — the raw seed
 *
 * Then 32 bytes of raw seed follow → total 48 bytes.
 */
const ED25519_PKCS8_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);

function rawHexToPrivateKey(privateHex: string): KeyObject {
  const raw = Buffer.from(privateHex, "hex");
  if (raw.length !== 32) {
    throw new Error(
      `Ed25519 private key must be 32 bytes (got ${raw.length}). ` +
        `Expected 64 hex chars.`,
    );
  }
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, raw]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function genKeyPair(): { privateHex: string; publicHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // Export PKCS8 DER, then strip the prefix to get raw 32-byte seed.
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  const privateRaw = privateDer.subarray(privateDer.length - 32);

  // Export SPKI DER, then strip the prefix to get raw 32-byte pubkey.
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const publicRaw = publicDer.subarray(publicDer.length - 32);

  return {
    privateHex: Buffer.from(privateRaw).toString("hex"),
    publicHex: Buffer.from(publicRaw).toString("hex"),
  };
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function isDirSync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFileSync(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readFileIfExists(path: string): Buffer | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function buildSignedPayload(dir: string): Buffer {
  const moduleJson = readFileIfExists(resolvePath(dir, "module.json"));
  const indexMjs = readFileIfExists(resolvePath(dir, "index.mjs"));
  if (!moduleJson) throw new Error(`Missing module.json in ${dir}`);
  if (!indexMjs) throw new Error(`Missing index.mjs in ${dir}`);
  const uiIndex = readFileIfExists(resolvePath(dir, "ui/index.mjs"));
  const parts: Buffer[] = [moduleJson, indexMjs];
  if (uiIndex) parts.push(uiIndex);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Zip read/write
// ---------------------------------------------------------------------------

interface ZipEntry {
  /** Path inside the zip (relative). */
  fileName: string;
  /** Whether the entry is a directory. */
  isDirectory: boolean;
  /** Raw bytes (empty Buffer for directories). */
  bytes: Buffer;
}

function extractZipToBuffers(zipPath: string): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error("yauzl returned no zipfile handle"));

      const entries: ZipEntry[] = [];

      zipfile.readEntry();
      zipfile.on("entry", (entry: yauzl.Entry) => {
        const isDir = /\/$/.test(entry.fileName);
        if (isDir) {
          entries.push({ fileName: entry.fileName, isDirectory: true, bytes: Buffer.alloc(0) });
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (rsErr, readStream) => {
          if (rsErr || !readStream) {
            reject(rsErr ?? new Error("openReadStream returned no stream"));
            return;
          }
          const chunks: Buffer[] = [];
          readStream.on("data", (c: Buffer) => chunks.push(c));
          readStream.on("end", () => {
            entries.push({
              fileName: entry.fileName,
              isDirectory: false,
              bytes: Buffer.concat(chunks),
            });
            zipfile.readEntry();
          });
          readStream.on("error", reject);
        });
      });
      zipfile.on("end", () => resolve(entries));
      zipfile.on("error", reject);
    });
  });
}

function writeZipFromEntries(
  entries: ZipEntry[],
  outZipPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("warning", (warnErr: NodeJS.ErrnoException) => {
      if (warnErr.code !== "ENOENT") reject(warnErr);
    });
    archive.on("error", reject);

    archive.pipe(output);
    for (const entry of entries) {
      if (entry.isDirectory) continue; // archiver handles directories implicitly
      archive.append(entry.bytes, { name: entry.fileName });
    }
    archive.finalize().catch(reject);
  });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

interface SignInputDir {
  kind: "dir";
  dir: string;
}

interface SignInputZip {
  kind: "zip";
  zipPath: string;
  tmpDir: string;
  entries: ZipEntry[];
}

type SignInput = SignInputDir | SignInputZip;

function prepareInput(pkgPath: string): Promise<SignInput> {
  if (isDirSync(pkgPath)) {
    return Promise.resolve({ kind: "dir", dir: pkgPath });
  }
  if (!isFileSync(pkgPath)) {
    throw new Error(`--pkg path is neither a directory nor a file: ${pkgPath}`);
  }
  return extractZipToBuffers(pkgPath).then((entries) => {
    const tmpDir = mkdtempSync(join(tmpdir(), "sign-hebbsmod-"));
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const target = join(tmpDir, entry.fileName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.bytes);
    }
    return { kind: "zip", zipPath: pkgPath, tmpDir, entries };
  });
}

function signPayload(payload: Buffer, privateKey: KeyObject): Buffer {
  // Ed25519: algorithm is `null` in Node's `crypto.sign`.
  return cryptoSign(null, payload, privateKey);
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`sign-hebbsmod: ${(err as Error).message}\n\n`);
    printHelp();
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (args.genKey) {
    const { privateHex, publicHex } = genKeyPair();
    process.stdout.write(
      [
        "",
        "Ed25519 keypair generated. Store the private key somewhere safe;",
        "publish only the public half in your host's module-publishers.json.",
        "",
        `  private (keep secret): ${privateHex}`,
        `  public  (publish):     ${publicHex}`,
        "",
        "Example entry for .data/module-publishers.json:",
        "",
        '  [ { "id": "your-org", "name": "Your Org", "publicKey": "' + publicHex + '" } ]',
        "",
      ].join("\n"),
    );
    return;
  }

  if (!args.pkg) {
    process.stderr.write("sign-hebbsmod: --pkg is required (or pass --gen-key)\n\n");
    printHelp();
    process.exit(2);
  }
  if (!args.privateKeyHex) {
    process.stderr.write("sign-hebbsmod: --key is required\n\n");
    printHelp();
    process.exit(2);
  }
  if (!args.publisherId) {
    process.stderr.write("sign-hebbsmod: --publisher-id is required\n\n");
    printHelp();
    process.exit(2);
  }

  const privateKey = rawHexToPrivateKey(args.privateKeyHex);
  // Confirm the matching public half is well-formed (catches a key
  // pasted as a public key, which would later fail signature verify).
  void createPublicKey(privateKey);

  const input = await prepareInput(args.pkg);
  const workingDir = input.kind === "dir" ? input.dir : input.tmpDir;

  const payload = buildSignedPayload(workingDir);
  const signature = signPayload(payload, privateKey);
  const meta = JSON.stringify(
    { publisherId: args.publisherId, algorithm: "ed25519" },
    null,
    2,
  );

  if (input.kind === "dir") {
    writeFileSync(resolvePath(input.dir, "signature"), signature);
    writeFileSync(resolvePath(input.dir, "signature.meta.json"), meta);
    process.stdout.write(
      [
        "",
        "  signed (directory)",
        `    pkg:         ${input.dir}`,
        `    publisher:   ${args.publisherId}`,
        `    payload:     ${payload.length} bytes`,
        `    signature:   ${signature.length} bytes`,
        "",
      ].join("\n"),
    );
    return;
  }

  // Rewrite the zip with new entries (signature + signature.meta.json
  // dropped in; any pre-existing entries with those names are replaced).
  const filtered = input.entries.filter(
    (e) => e.fileName !== "signature" && e.fileName !== "signature.meta.json",
  );
  filtered.push({ fileName: "signature", isDirectory: false, bytes: signature });
  filtered.push({
    fileName: "signature.meta.json",
    isDirectory: false,
    bytes: Buffer.from(meta, "utf8"),
  });

  await writeZipFromEntries(filtered, input.zipPath);
  // Clean up the staging extraction.
  try {
    rmSync(input.tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }

  process.stdout.write(
    [
      "",
      "  signed (.hebbsmod)",
      `    pkg:         ${input.zipPath}`,
      `    publisher:   ${args.publisherId}`,
      `    payload:     ${payload.length} bytes`,
      `    signature:   ${signature.length} bytes`,
      "",
    ].join("\n"),
  );
}

// Only run when invoked as a CLI.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`sign-hebbsmod: ${msg}\n`);
    process.exit(1);
  });
}
