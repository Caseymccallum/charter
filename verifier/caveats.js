/**
 * What a VERIFIED verdict does not mean.
 *
 * These are not checks and they never affect the exit code. They are the gaps
 * this verifier knows it has, printed with every verdict so that a reader who
 * sees "VERIFIED" also sees the boundary of the claim. A limitation listed here
 * is a thing no amount of care could decide from the artifact alone, which is
 * why it is written down rather than guessed at.
 *
 * @module verifier/caveats
 */

/**
 * @typedef {Object} Caveat
 * @property {string} id
 * @property {string} statement
 */

/** @type {readonly Caveat[]} */
export const CAVEATS = Object.freeze([
  Object.freeze({
    id: 'INTERMEDIATE_CONTENT_HASHES',
    statement: 'Every entry but the last declares a content_sha256 that nothing in the artifact can confirm: the bytes of an intermediate revision are not in the file. Only the final revision is bound to content.md.',
  }),
  Object.freeze({
    id: 'KEY_HOLDER_CAN_REWRITE_HISTORY',
    statement: 'Whoever holds the private key can replace the last entry, or every entry, and re-sign the whole log, and this verifier cannot tell that the earlier bytes ever existed. The chain proves order and continuity, not uniqueness.',
  }),
  Object.freeze({
    id: 'KEYS_ARE_SELF_DECLARED',
    statement: 'The public key travels inside the file it signs, so a valid signature proves only that the signer held the matching private key. Nothing here ties a key to a person, an organisation, or a name a reader would recognise.',
  }),
  Object.freeze({
    id: 'TIMESTAMPS_ARE_CLAIMS',
    statement: 'Every timestamp is written by the signer and signed by the signer. Nothing in the format witnesses a time, so an entry can carry any instant its author chose.',
  }),
  Object.freeze({
    id: 'CONTENT_IS_NOT_JUDGED',
    statement: 'This verifier reads the bytes of content.md and checks that they are UTF-8 and match the declared digest. It does not interpret them, and a well-formed artifact can hold content that is false, unlawful, or worthless.',
  }),
]);
