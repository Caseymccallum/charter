/**
 * Every declaration `SPEC.md` makes that code states a second time.
 *
 * Step 20 found four declarations that code held twice and no test held to the
 * document. Step 21 audited the document and found **fourteen** gaps of the same
 * shape, and stopped there: the rule for that work is that more than three
 * instances of a pattern is answered by a mechanism rather than by more tests.
 * This file is the mechanism.
 *
 * ## What a row is
 *
 * One row per declaration. A row carries:
 *
 * - **a spec locator** — `spec`, naming the section, an anchor string that must
 *   appear in it, and how to read the claim out of the text between that anchor
 *   and `end`. The anchor is what makes a row fail loudly when the sentence it
 *   reads is reworded, instead of quietly reading nothing;
 * - **a code accessor** — `exports`, the named exports of `verifier/**` that
 *   state the same claim. One row may name several when they are one
 *   declaration (`REQUIRED_ENTRIES` and the three entry names it holds);
 * - **a comparison** — `compare`, one of `set`, `values`, `count`, `ids`,
 *   `bits`, `member`, `bullets`.
 *
 * Nothing here is transcribed. Every name and number in a row is read out of
 * `SPEC.md` by the reader, which is the only thing that walks this table:
 * `test/declarations.test.js`.
 *
 * ## Why the exemptions are short
 *
 * `EXEMPT` names the exported constants that are not declarations, and each
 * carries a reason rather than a shrug. It has two entries: the byte the format
 * ends a document with, and the width of a hash. Both are facts about an
 * algorithm or a byte rather than statements about this format, and neither has
 * a sentence in `SPEC.md` a reader could compare against.
 *
 * The enforcement half in the reader is the point of the file: every exported
 * constant of `verifier/**` appears either in a row here or in `EXEMPT`, checked
 * in both directions. A declaration added to the code without a row fails —
 * which is what makes this a mechanism and not an inventory, because the audit
 * found its fourteen by grepping for five prose shapes and the fifteenth will
 * not use one.
 *
 * @module test/declarations
 */

/**
 * @typedef {Object} Declaration
 * @property {string} id
 * @property {string} what a sentence a reader can check the row against
 * @property {{ section: string, anchor: string, end?: string, read: string, arg?: string }} spec
 * @property {string[]} exports the named exports of `verifier/**` that state it again
 * @property {string} compare
 * @property {string} [filter] for a claim about the members of a register
 */

/** The artifact. */
const ARTIFACT = [
  {
    id: 'entries.required',
    what: 'the required-entry list holds exactly the three names the document fixes',
    spec: { section: '2. The artifact', anchor: 'It holds exactly three entries:', read: 'table-names', arg: '1' },
    exports: ['REQUIRED_ENTRIES'],
    compare: 'set',
  },
  {
    id: 'entries.names',
    what: 'the three entry names are the three the document fixes',
    spec: { section: '2. The artifact', anchor: 'It holds exactly three entries:', read: 'table-names', arg: '1' },
    exports: ['ENTRY_MANIFEST', 'ENTRY_CONTENT', 'ENTRY_PROVENANCE'],
    compare: 'set',
  },
];

/** The container. */
const CONTAINER = [
  {
    id: 'version.max-version-needed',
    what: 'the ZIP feature level an entry needs is at most 20',
    spec: { section: '3.2 Feature level', anchor: 'it is at most ', end: ' (2.0)', read: 'numbers' },
    exports: ['MAX_VERSION_NEEDED'],
    compare: 'values',
  },
  {
    id: 'version.version-needed',
    what: 'the level this writer declares is the level this reader implements',
    spec: { section: '3.2 Feature level', anchor: 'it is at most ', end: ' (2.0)', read: 'numbers' },
    exports: ['VERSION_NEEDED'],
    compare: 'values',
  },
  {
    id: 'zip.methods',
    what: 'an entry is stored (method 0) or raw-deflated (method 8), and nothing else',
    spec: { section: '3.3 Compression and flags', anchor: 'Each entry is stored (method ', end: '. Anything else', read: 'numbers' },
    exports: ['METHOD_STORED', 'METHOD_DEFLATE'],
    compare: 'values',
  },
  {
    id: 'zip.flags-allowed',
    what: 'exactly three general purpose bits are allowed',
    spec: { section: '3.3 Compression and flags', anchor: 'Exactly three general purpose bits are allowed:', end: 'Five more bits', read: 'names' },
    exports: ['FLAGS_ALLOWED'],
    compare: 'bits',
  },
  {
    id: 'zip.flags-unsupported',
    what: 'five more bits describe features this reader does not implement',
    spec: { section: '3.3 Compression and flags', anchor: 'Five more bits describe features this reader does', end: 'Any other bit is', read: 'names' },
    exports: ['STRUCTURAL_FLAGS'],
    compare: 'bits',
  },
  {
    id: 'zip.flag-utf8-name',
    what: 'the bit that says the name is UTF-8 is one of the three allowed',
    spec: { section: '3.3 Compression and flags', anchor: 'Exactly three general purpose bits are allowed:', end: 'Five more bits', read: 'names' },
    exports: ['FLAG_UTF8_NAME'],
    compare: 'member',
  },
  {
    id: 'zip.metadata-version-made-by',
    what: 'version made by is 0x0014: version 2.0 on host 0',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-value', arg: 'version made by' },
    exports: ['VERSION_MADE_BY'],
    compare: 'values',
  },
  {
    id: 'zip.metadata-dos-date',
    what: 'the last mod file date is 0x0021: 1980-01-01',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-value', arg: 'last mod file date' },
    exports: ['DOS_DATE'],
    compare: 'values',
  },
  {
    id: 'zip.metadata-dos-time',
    what: 'the last mod file time is 0: 00:00:00',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-value', arg: 'last mod file time' },
    exports: ['DOS_TIME'],
    compare: 'values',
  },
  {
    id: 'zip.metadata-disk-number-start',
    what: 'disk number start is 0: a charter holds one disk',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-zero', arg: 'disk number start' },
    exports: ['DISK_NUMBER_START'],
    compare: 'values',
  },
  {
    id: 'zip.metadata-internal-attributes',
    what: 'the internal attributes word is 0',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-zero', arg: 'internal attributes' },
    exports: ['INTERNAL_ATTRIBUTES'],
    compare: 'values',
  },
  {
    id: 'zip.metadata-external-attributes',
    what: 'the external attributes word is 0',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-zero', arg: 'external attributes' },
    exports: ['EXTERNAL_ATTRIBUTES'],
    compare: 'values',
  },
  {
    id: 'zip.metadata-extra-field',
    what: 'the extra field is zero bytes long, in the local header and in the directory record',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-zero', arg: 'extra field' },
    exports: ['EXTRA_FIELD_BYTES'],
    compare: 'values',
  },
  {
    id: 'zip.metadata-record-comment',
    what: 'the directory record carries no comment: zero bytes',
    spec: { section: '3.6 Metadata the format fixes', anchor: 'charter/0.1 fixes all of them, and', read: 'row-zero', arg: 'record comment' },
    exports: ['RECORD_COMMENT_BYTES'],
    compare: 'values',
  },
];

/** The manifest, the log, the keys and the document. */
const DOCUMENTS = [
  {
    id: 'manifest.fields',
    what: 'a manifest carries these six fields and no other',
    spec: { section: '5. `manifest.json`', anchor: 'no other field than these six:', read: 'table-names', arg: '1' },
    exports: ['MANIFEST_FIELDS'],
    compare: 'set',
  },
  {
    id: 'manifest.content-fields',
    what: 'the content object has exactly one field',
    spec: { section: '5. `manifest.json`', anchor: 'no other field than these six:', read: 'row-value', arg: 'content' },
    exports: ['MANIFEST_CONTENT_FIELDS'],
    compare: 'set',
  },
  {
    id: 'manifest.author-fields',
    what: 'the author object has exactly these four fields',
    spec: { section: '5. `manifest.json`', anchor: 'no other field than these six:', read: 'row-value', arg: 'author' },
    exports: ['MANIFEST_AUTHOR_FIELDS'],
    compare: 'set',
  },
  {
    id: 'manifest.algorithm',
    what: 'this version defines exactly one algorithm value',
    spec: { section: '5. `manifest.json`', anchor: 'this version defines exactly', end: '`. An algorithm', read: 'quoted' },
    exports: ['ALGORITHM'],
    compare: 'set',
  },
  {
    id: 'format.identifier',
    what: 'manifest.format is exactly "charter/0.1"',
    spec: { section: '5. `manifest.json`', anchor: '| `format` | present, a string, and exactly', end: ' |', read: 'quoted' },
    exports: ['FORMAT'],
    compare: 'set',
  },
  {
    id: 'provenance.entry-fields',
    what: 'an entry carries exactly these seven fields',
    spec: { section: '7. `provenance.jsonl`', anchor: 'each object carrying exactly these seven fields:', read: 'table-names', arg: '1' },
    exports: ['ENTRY_FIELDS'],
    compare: 'set',
  },
  {
    id: 'provenance.entry-author-fields',
    what: "an entry's author has exactly these two fields",
    spec: { section: '7. `provenance.jsonl`', anchor: 'each object carrying exactly these seven fields:', read: 'row-value', arg: 'author' },
    exports: ['ENTRY_AUTHOR_FIELDS'],
    compare: 'set',
  },
  {
    id: 'provenance.entry-actions',
    what: 'an action is "create" or "edit", and nothing else',
    spec: { section: '7. `provenance.jsonl`', anchor: 'each object carrying exactly these seven fields:', read: 'row-value', arg: 'action' },
    exports: ['ACTIONS'],
    compare: 'set',
  },
  {
    id: 'keys.algorithm',
    what: 'there is one algorithm, spelled ed25519',
    spec: { section: '8. Keys and key ids', anchor: 'One algorithm: ', end: ' A public key is ', read: 'names' },
    exports: ['ALGORITHM'],
    compare: 'set',
  },
  {
    id: 'keys.algorithm-name',
    what: 'the algorithm is named Ed25519',
    spec: { section: '8. Keys and key ids', anchor: 'One algorithm: ', read: 'word' },
    exports: ['ALGORITHM_NAME'],
    compare: 'set',
  },
  {
    id: 'keys.public-key-bytes',
    what: 'a public key is 32 bytes',
    spec: { section: '8. Keys and key ids', anchor: 'A public key is', end: ' and a signature is', read: 'numbers' },
    exports: ['PUBLIC_KEY_BYTES'],
    compare: 'values',
  },
  {
    id: 'keys.signature-bytes',
    what: 'a signature is 64 bytes',
    spec: { section: '8. Keys and key ids', anchor: 'and a signature is', end: ' both written as', read: 'numbers' },
    exports: ['SIGNATURE_BYTES'],
    compare: 'values',
  },
  {
    id: 'keys.digest-hex-length',
    what: 'a content_sha256 is 64 lowercase hex characters',
    spec: { section: '7. `provenance.jsonl`', anchor: '| `content_sha256` | ', end: ' |', read: 'numbers' },
    exports: ['DIGEST_HEX_LENGTH'],
    compare: 'values',
  },
  {
    id: 'content.hash-name',
    what: 'the digest is SHA-256 of the content bytes',
    spec: { section: '6. `content.md`', anchor: '`L0.CONTENT.HASH`: ', read: 'word' },
    exports: ['HASH_NAME'],
    compare: 'set',
  },
];

/** The published ceilings, the verdict vocabulary, and the registers. */
const VERDICTS = [
  {
    id: 'limits.table',
    what: 'the nine ceilings of section 3.7, in the order the table lists them',
    spec: { section: '3.7 Limits', anchor: '| Dimension | Ceiling |', read: 'measures' },
    exports: ['LIMITS'],
    compare: 'values',
  },
  {
    id: 'status.statuses',
    what: 'every check ends in exactly one of four statuses, and these are the four',
    spec: { section: '10. Verdicts', anchor: 'Every check ends in exactly one of four statuses:', read: 'table-names', arg: '1' },
    exports: ['STATUS'],
    compare: 'set',
  },
  {
    id: 'status.status-count',
    what: 'the number the status table states is the number of rows under it',
    spec: { section: '10. Verdicts', anchor: 'Every check ends in exactly one of ', read: 'count-rows' },
    exports: ['STATUS'],
    compare: 'count',
  },
  {
    id: 'status.verdicts',
    what: 'there are three verdicts, and these are their names',
    spec: { section: '10. Verdicts', anchor: 'Three verdicts, over all 30 checks:', read: 'table-names', arg: '1' },
    exports: ['VERDICT'],
    compare: 'set',
  },
  {
    id: 'status.exit-codes',
    what: 'the exit code each verdict carries',
    spec: { section: '10. Verdicts', anchor: 'Three verdicts, over all 30 checks:', read: 'table-column', arg: '3' },
    exports: ['EXIT_CODE'],
    compare: 'values',
  },
  {
    id: 'status.levels',
    what: 'the three levels the checks are grouped into',
    spec: { section: '10. Verdicts', anchor: 'The 30 checks, in the order they always appear in a verdict:', read: 'table-unique', arg: '1' },
    exports: ['LEVEL'],
    compare: 'set',
  },
  {
    id: 'status.check-registry',
    what: 'the 30 checks, in the order they always appear in a verdict',
    spec: { section: '10. Verdicts', anchor: 'The 30 checks, in the order they always appear in a verdict:', read: 'table-ids' },
    exports: ['CHECK_REGISTRY'],
    compare: 'ids',
  },
  {
    id: 'status.check-ids',
    what: 'the same 30 ids, as the list the reporter is held to',
    spec: { section: '10. Verdicts', anchor: 'The 30 checks, in the order they always appear in a verdict:', read: 'table-ids' },
    exports: ['CHECK_IDS'],
    compare: 'set',
  },
  {
    id: 'status.reasons',
    what: 'the closed reason-code vocabulary section 10 names',
    spec: { section: '10. Verdicts', anchor: 'A reason code is attached to every result:', end: '. The prose', read: 'sentence-names' },
    exports: ['REASON'],
    compare: 'set',
  },
  {
    id: 'caveats.count',
    what: 'the verifier prints these five statements with every verdict',
    spec: { section: '11. What this does not protect against', anchor: 'statements with every verdict', read: 'count-before' },
    exports: ['CAVEATS'],
    compare: 'count',
  },
  {
    id: 'content.requirements',
    what: 'content.md has three requirements and no others',
    spec: { section: '6. `content.md`', anchor: 'requirements and no others:', read: 'count-bullets' },
    exports: [],
    compare: 'bullets',
  },
  {
    id: 'content.check-ids',
    what: 'the checks section 6 names are the ones the registry holds for its level',
    spec: { section: '6. `content.md`', read: 'section-ids' },
    exports: [],
    compare: 'set',
    filter: 'L0.CONTENT.',
  },
  {
    id: 'chain.consequences',
    what: 'three consequences follow from the chain rule, and each is a check',
    spec: { section: '9. The chain', anchor: 'consequences follow', read: 'count-bullets' },
    exports: [],
    compare: 'bullets',
  },
  {
    id: 'chain.check-ids',
    what: 'the checks section 9 names are the ones the registry holds for its level',
    spec: { section: '9. The chain', read: 'section-ids' },
    exports: [],
    compare: 'set',
    filter: 'L2.CHAIN.',
  },
];

/** Every declaration, in one table: this is what the reader walks. */
export const REGISTRY = Object.freeze([...ARTIFACT, ...CONTAINER, ...DOCUMENTS, ...VERDICTS]);

/**
 * The exported constants that are not declarations, and why each is not.
 *
 * Both are facts about an algorithm or a byte rather than statements about this
 * format. Everything else exported by `verifier/**` is in `REGISTRY`, and the
 * reader fails when that stops being true in either direction.
 *
 * @type {Record<string, string>}
 */
export const EXEMPT = Object.freeze({
  'verifier/canonical-write.js#LF':
    'the byte a canonical document ends with. Section 4.1 names it as "one LF", but the constant is the byte 0x0a: a row would compare 0x0a against the word LF and assert nothing a sentence could disagree with',
  'verifier/manifest.js#DIGEST_BYTES':
    'the width of a SHA-256 digest, fixed by the algorithm rather than by this format. Section 7 states a digest as 64 lowercase hex characters, which DIGEST_HEX_LENGTH is registered against, and the document never states a digest width in bytes',
});
