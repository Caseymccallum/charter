/**
 * The manifest: what the artifact says about itself.
 *
 * Field kinds are checked here; encodings that have a check of their own are
 * left to that check, so no two checks report the same defect. `format` is a
 * string here and "charter/0.1" in L0.FORMAT.IDENTIFIER; `content.sha256` and
 * `author.key_id` are strings here and digests in the checks that use them.
 *
 * @module verifier/manifest
 */

import { toHex } from './bytes.js';
import { sha256 } from './digest.js';
import { signingInput } from './canonical.js';
import { describeType, findUnknownField, readField } from './schema.js';
import { REASON } from './status.js';

/** The one format identifier this verifier implements. */
export const FORMAT = 'charter/0.1';

/** The one signature algorithm this verifier implements. */
export const ALGORITHM = 'ed25519';

/** Ed25519 public keys are 32 bytes and signatures are 64 bytes. */
export const PUBLIC_KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;

/** SHA-256 digests are 32 bytes, written as 64 lowercase hex characters. */
export const DIGEST_BYTES = 32;
export const DIGEST_HEX_LENGTH = DIGEST_BYTES * 2;

/** The fields `manifest.json` may contain, and nothing else. */
export const MANIFEST_FIELDS = Object.freeze(['author', 'content', 'created_at', 'format', 'signature', 'title']);
export const MANIFEST_CONTENT_FIELDS = Object.freeze(['sha256']);
export const MANIFEST_AUTHOR_FIELDS = Object.freeze(['algorithm', 'key_id', 'name', 'public_key']);

/**
 * The key id of a public key: the algorithm's name, a colon, and the lowercase
 * hex SHA-256 of the key's 32 bytes.
 *
 * A key id is a name for a key, not a secret. Deriving it from the key bytes is
 * what stops an artifact from carrying a key id that belongs to some other key:
 * the id in an entry is only useful if a reader can recompute it from the key
 * the artifact carries.
 *
 * @param {Uint8Array} publicKey 32 bytes
 * @returns {Promise<string | null>} null when this runtime cannot hash
 */
export async function deriveKeyId(publicKey) {
  const digest = await sha256(publicKey);
  return digest === null ? null : `${ALGORITHM}:${toHex(digest)}`;
}

/**
 * @param {string | null} key
 * @param {string} where
 * @returns {string | null}
 */
function prefixUnknown(key, where) {
  return key === null ? null : `${where}.${key}`;
}

/**
 * Read and check the manifest value.
 *
 * On success the returned manifest holds converted values only: digests and key
 * ids as their canonical lowercase text, keys and signatures as bytes, plus the
 * signing input those fields are covered by.
 *
 * @param {unknown} value the parsed contents of manifest.json
 * @returns {{ ok: true, manifest: object, unknown_field: string | null }
 *   | { ok: false, path: string, reason_code: string, detail: string }}
 */
export function readManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, path: 'manifest', reason_code: REASON.MALFORMED, detail: `the manifest is ${describeType(value)}, not a JSON object` };
  }
  const object = /** @type {Record<string, unknown>} */ (value);

  const format = readField(object, 'format', { kind: 'string', non_empty: true }, 'manifest');
  if (!format.ok) return { ok: false, path: 'manifest.format', reason_code: format.reason_code, detail: format.detail };
  const title = readField(object, 'title', { kind: 'string', non_empty: true }, 'manifest');
  if (!title.ok) return { ok: false, path: 'manifest.title', reason_code: title.reason_code, detail: title.detail };
  const createdAt = readField(object, 'created_at', { kind: 'timestamp' }, 'manifest');
  if (!createdAt.ok) return { ok: false, path: 'manifest.created_at', reason_code: createdAt.reason_code, detail: createdAt.detail };
  const signature = readField(object, 'signature', { kind: 'string', non_empty: true }, 'manifest');
  if (!signature.ok) return { ok: false, path: 'manifest.signature', reason_code: signature.reason_code, detail: signature.detail };

  const content = readField(object, 'content', { kind: 'object' }, 'manifest');
  if (!content.ok) return { ok: false, path: 'manifest.content', reason_code: content.reason_code, detail: content.detail };
  const contentObject = /** @type {Record<string, unknown>} */ (content.value);
  const sha256 = readField(contentObject, 'sha256', { kind: 'string', non_empty: true }, 'manifest.content');
  if (!sha256.ok) return { ok: false, path: 'manifest.content.sha256', reason_code: sha256.reason_code, detail: sha256.detail };

  const author = readField(object, 'author', { kind: 'object' }, 'manifest');
  if (!author.ok) return { ok: false, path: 'manifest.author', reason_code: author.reason_code, detail: author.detail };
  const authorObject = /** @type {Record<string, unknown>} */ (author.value);
  const name = readField(authorObject, 'name', { kind: 'string', non_empty: true }, 'manifest.author');
  if (!name.ok) return { ok: false, path: 'manifest.author.name', reason_code: name.reason_code, detail: name.detail };
  const algorithm = readField(authorObject, 'algorithm', { kind: 'enum', values: [ALGORITHM] }, 'manifest.author');
  if (!algorithm.ok) return { ok: false, path: 'manifest.author.algorithm', reason_code: algorithm.reason_code, detail: algorithm.detail };
  const keyId = readField(authorObject, 'key_id', { kind: 'string', non_empty: true }, 'manifest.author');
  if (!keyId.ok) return { ok: false, path: 'manifest.author.key_id', reason_code: keyId.reason_code, detail: keyId.detail };
  const publicKey = readField(authorObject, 'public_key', { kind: 'string', non_empty: true }, 'manifest.author');
  if (!publicKey.ok) return { ok: false, path: 'manifest.author.public_key', reason_code: publicKey.reason_code, detail: publicKey.detail };

  const unknown =
    findUnknownField(object, MANIFEST_FIELDS) ??
    prefixUnknown(findUnknownField(contentObject, MANIFEST_CONTENT_FIELDS), 'manifest.content') ??
    prefixUnknown(findUnknownField(authorObject, MANIFEST_AUTHOR_FIELDS), 'manifest.author');

  return {
    ok: true,
    unknown_field: unknown,
    manifest: Object.freeze({
      format: format.value,
      title: title.value,
      created_at: createdAt.value,
      content: Object.freeze({ sha256: sha256.value }),
      author: Object.freeze({
        name: name.value,
        algorithm: algorithm.value,
        key_id: keyId.value,
        public_key: publicKey.value,
      }),
      signature: signature.value,
      signing_input: signingInput(object, 'signature'),
    }),
  };
}
