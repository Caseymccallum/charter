/**
 * `cite`: what a `.charter` file is, as CSL-JSON.
 *
 * CSL-JSON is what a reference manager reads, and a charter is a document that
 * carries its own history, so the item here is deliberately small: an identifier
 * that is the claim's own hash, the author the file names, the time the file
 * states, the day it was read, and a `custom.charter` block holding the
 * artifact's facts.
 *
 * # Where a title comes from, and why there are three answers
 *
 * A citation wants a title, and a `.charter` file offers three different
 * statements:
 *
 *   - an HTML `<title>` element, or the first ATX heading, inside `content.md` —
 *     the document's own text, covered by the digest the manifest declares;
 *   - `manifest.title` — the artifact's claim about itself, signed by the author
 *     but not part of the content digest;
 *   - `--title` — what the person citing says, which is not in the file at all.
 *
 * Those are not interchangeable, so the item records which one it used, in
 * `custom.charter.title_source` and `title_origin`, and the note says it in
 * prose as well. Precedence is what the caller states, then what the captured
 * bytes carry, then what the manifest claims. A stated title wins because the
 * person citing is the one making the citation; a captured title wins over the
 * manifest's because it sits inside the bytes the identifier names. A reader who
 * wanted the other one can see exactly where to look, which is the point of
 * writing it down.
 *
 * Times come from the file and are the author's claims. The one date from
 * outside the file is `accessed` — the day the citation was made — and the
 * command line supplies it, because this module does not read a clock.
 *
 * @module producer/cite
 */

import { toHex } from '../verifier/bytes.js';
import { sha256 } from '../verifier/digest.js';
import { isIsoUtcSecond } from '../verifier/schema.js';
import { REASON } from '../verifier/status.js';
import { refuse } from './errors.js';
import { deriveTitle, TITLE_ORIGINS } from './title.js';

/** The CSL item type: a written document, which is what a charter carries. */
export const CSL_TYPE = 'manuscript';

/**
 * How the title of an item is known. Every item records exactly one of these,
 * because "the title of the document" and "the title of the file" are two
 * different claims, and a citation that blurred them would be a guess.
 */
export const TITLE_STATUS = Object.freeze({
  /** The person citing stated it. */
  ASSERTED: 'asserted',
  /** It was read out of the captured bytes, which the identifier names. */
  DERIVED: 'derived',
  /** It is the manifest's own claim, which the content digest does not cover. */
  CLAIMED: 'claimed',
  /** Nobody states one, so the item carries no title. */
  ABSENT: 'absent',
});

/** What each status means, in the words the item's note uses. */
const TITLE_SENTENCE = Object.freeze({
  [TITLE_STATUS.ASSERTED]: 'The title is the one the caller stated.',
  [TITLE_STATUS.DERIVED]: 'The title was read out of the cited document itself, so it is covered by the digest this item names.',
  [TITLE_STATUS.CLAIMED]: "The title is the artifact's own claim about itself, which the content digest does not cover.",
  [TITLE_STATUS.ABSENT]: 'Neither the file nor the caller states a title.',
});

const ISO_UTC_SECOND = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} text an ISO 8601 UTC date-time
 * @returns {number[][]} CSL date-parts: [[year, month, day]], as integers
 */
function dateParts(text) {
  const match = ISO_UTC_SECOND.exec(text);
  if (match === null) {
    refuse(REASON.MALFORMED, `the time ${JSON.stringify(text)} is not an ISO 8601 UTC date-time, so it cannot be written as a CSL date`);
  }
  return [[Number(match[1]), Number(match[2]), Number(match[3])]];
}

/**
 * The day a citation was made, as CSL date-parts.
 *
 * The day is validated with the reader's own rule rather than with a second
 * calendar: `isIsoUtcSecond` already knows that February has 29 days in a leap
 * year, and an access date is the same shape as every other date this format
 * carries.
 *
 * @param {string} text `YYYY-MM-DD`
 * @returns {number[][]}
 */
function accessDate(text) {
  if (typeof text !== 'string' || !DATE_ONLY.test(text) || !isIsoUtcSecond(`${text}T00:00:00Z`)) {
    refuse(REASON.MALFORMED, `the access date is ${JSON.stringify(text)}, and a date is written YYYY-MM-DD`, 'accessed');
  }
  return dateParts(`${text}T00:00:00Z`);
}

/**
 * @param {object} claims what the file says about itself
 * @param {Uint8Array | null} content the captured document, if it could be read
 * @param {string | undefined} stated a title the caller stated
 * @returns {{ title: string | null, status: string, origin: string | null }}
 */
function decideTitle(claims, content, stated) {
  if (stated !== undefined) {
    if (typeof stated !== 'string' || stated.trim() === '') {
      refuse(REASON.MALFORMED, 'the title stated for this citation is empty', 'title');
    }
    return { title: stated.trim(), status: TITLE_STATUS.ASSERTED, origin: TITLE_ORIGINS.STATED };
  }
  if (content !== null) {
    const derived = deriveTitle(content);
    if (derived !== null) return { title: derived.title, status: TITLE_STATUS.DERIVED, origin: derived.origin };
  }
  if (typeof claims.title === 'string' && claims.title !== '') {
    return { title: claims.title, status: TITLE_STATUS.CLAIMED, origin: TITLE_ORIGINS.MANIFEST };
  }
  return { title: null, status: TITLE_STATUS.ABSENT, origin: null };
}

/**
 * Build the CSL-JSON item for one artifact.
 *
 * @param {object} input
 * @param {object} input.claims what `readCharter` read out of the manifest
 * @param {Uint8Array | null} input.content the bytes of `content.md`, or null
 * @param {Uint8Array} input.artifact the bytes of the `.charter` file itself
 * @param {string} [input.title] a title the caller states
 * @param {string} input.accessed the day the citation is made, `YYYY-MM-DD`
 * @returns {Promise<object>} one CSL-JSON item, ready to be `JSON.stringify`d
 */
export async function citationItem(input) {
  const { claims } = input;
  const title = decideTitle(claims, input.content ?? null, input.title);

  const digest = await sha256(input.artifact);
  if (digest === null) {
    refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so the file this citation was made from could not be identified');
  }
  const entries =
    claims.entries === null
      ? 'a provenance log this producer could not split into lines'
      : claims.entries === 1
        ? 'one signed provenance entry'
        : `${claims.entries} signed provenance entries`;

  return {
    id: claims.content_sha256,
    type: CSL_TYPE,
    ...(title.title === null ? {} : { title: title.title }),
    author: [{ literal: claims.author_name }],
    issued: dateParts(claims.created_at),
    accessed: accessDate(input.accessed),
    note: `The document this cites is the byte sequence whose SHA-256 is ${claims.content_sha256}, in a .charter file holding ${entries}. ${TITLE_SENTENCE[title.status]} Times stated in the file are the author's own claims, and a citation records what a file says rather than whether the file holds up.`,
    custom: {
      charter: {
        format: claims.format,
        key_id: claims.author_key_id,
        entries: claims.entries,
        artifact_sha256: toHex(digest),
        created_at: claims.created_at,
        title_source: title.status,
        title_origin: title.origin,
      },
    },
  };
}
