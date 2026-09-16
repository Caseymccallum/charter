/**
 * Resource limits.
 *
 * A verifier that can be made to allocate without bound is a verifier that can
 * be made to hang, so every dimension of the artifact has a declared ceiling.
 * Exceeding one is a refusal with reason LIMIT_EXCEEDED, never a slow success
 * and never a pass: an artifact too large to check is not an artifact this
 * verifier has checked.
 *
 * These numbers are part of the published behaviour of charter/0.1. Changing
 * one changes what a verdict means, so the change belongs in the specification
 * and in the recorded conformance answers, not in a patch.
 *
 * @module verifier/limits
 */

export const LIMITS = Object.freeze({
  /** Whole `.charter` file. */
  MAX_ARCHIVE_BYTES: 256 * 1024 * 1024,
  /** Compressed bytes of any one entry. */
  MAX_ENTRY_COMPRESSED_BYTES: 64 * 1024 * 1024,
  /** Uncompressed bytes of any one entry; inflation stops past this. */
  MAX_ENTRY_BYTES: 64 * 1024 * 1024,
  /** Lines in provenance.jsonl. */
  MAX_PROVENANCE_ENTRIES: 100000,
  /** Bytes of one provenance line. */
  MAX_PROVENANCE_LINE_BYTES: 1024 * 1024,
  /** Nesting depth of any accepted JSON value. */
  MAX_JSON_DEPTH: 64,
  /** Length of a ZIP entry name, per the ZIP specification. */
  MAX_ZIP_NAME_BYTES: 65535,
  /** Size of the ZIP end-of-central-directory search range, per the ZIP specification. */
  MAX_ZIP_EOCD_SEARCH_BYTES: 65535,
});
