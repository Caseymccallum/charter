/**
 * The title a captured document carries.
 *
 * `manifest.json` has a `title` field, and it is a claim the author makes about
 * the artifact. A capture often says what it is *inside its own bytes*, which is
 * a different kind of statement: the bytes of `content.md` are the content, so a
 * title found there is covered by the digest the manifest declares, and a title
 * found in the manifest is not.
 *
 * This module finds the two places a captured Markdown document carries one, in
 * that order: an HTML `<title>` element, then the first ATX heading. It is not a
 * Markdown parser and does not become one: it locates an element and a line, and
 * takes the text literally. Inline markup is not interpreted, entities are not
 * decoded, and only one thing is normalized — a run of whitespace inside the
 * title becomes one space, because a title that spans two lines is one title.
 * Whatever is found here is reported as *derived* wherever it is used; nothing
 * in this module asserts that the document is titled anything.
 *
 * @module producer/title
 */

import { utf8Decode } from '../verifier/bytes.js';

/** Where a title came from. Reported next to every title this project prints. */
export const TITLE_ORIGINS = Object.freeze({
  /** The person sealing or citing stated it, so it is an assertion. */
  STATED: 'stated',
  /** An HTML `<title>` element inside the captured bytes. */
  ELEMENT: 'title-element',
  /** The first ATX heading (`# ...` through `###### ...`) inside the captured bytes. */
  HEADING: 'heading',
  /** The name of the file the content was read from, which is not in its bytes. */
  FILE_NAME: 'content-file-name',
  /** `manifest.title`, the artifact's own claim about itself. */
  MANIFEST: 'manifest',
});

const TITLE_ELEMENT = /<title[^>]*>([\s\S]*?)<\/title>/i;
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;

/**
 * @param {string} text
 * @returns {string} the text with every run of whitespace collapsed to one space
 */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The title a captured document carries, or null.
 *
 * A document that decodes as UTF-8 but holds neither an element nor a heading
 * has no title here, and that is the honest answer: this function derives a
 * title, so it never invents one.
 *
 * @param {Uint8Array} content the bytes of `content.md`
 * @returns {{ title: string, origin: string } | null}
 */
export function deriveTitle(content) {
  const decoded = utf8Decode(content);
  if (!decoded.ok) return null;

  const element = TITLE_ELEMENT.exec(decoded.text);
  if (element !== null) {
    const title = collapse(element[1]);
    if (title !== '') return { title, origin: TITLE_ORIGINS.ELEMENT };
  }

  for (const line of decoded.text.split('\n')) {
    const heading = ATX_HEADING.exec(line);
    if (heading === null) continue;
    // A closing sequence of #s closes the heading, and only when a space comes
    // before it: `# Title #` is "Title", and `# C#` is "C#".
    const text = heading[2].replace(/[ \t]+#+[ \t]*$/, '');
    const title = collapse(text);
    if (title !== '') return { title, origin: TITLE_ORIGINS.HEADING };
  }
  return null;
}

/**
 * The name of the file a document was read from, as a last resort.
 *
 * This is not a title the document carries — it is the name of the file the
 * person sealing happened to have it in — so a caller that uses it must say so.
 * It exists so that a manifest's required `title` can always be filled with
 * something a person recognises, rather than with a placeholder the producer
 * invented.
 *
 * @param {string} path the path the content was read from
 * @returns {string} the file's name, without its last extension
 */
export function titleFromPath(path) {
  const parts = path.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? path;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const title = collapse(stem);
  return title === '' ? 'untitled' : title;
}
