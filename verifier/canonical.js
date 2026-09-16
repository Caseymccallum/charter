/**
 * Canonical JSON, and nothing else.
 *
 * # The shape of the parser
 *
 * A single recursive-descent scan that validates as it reads. There is no
 * token stream, no parse tree kept alongside a separate validation pass, and no
 * second opinion: `Cursor` holds the whole text, a position, the depth ceiling,
 * and a `violation` slot, and `parseValue` dispatches on the leading character.
 * `parseObject` and `parseArray` build their value as they descend and return
 * `undefined` the moment a violation is recorded, so the first violation is
 * both the recorded one and the only one reported — every later finding would be
 * a consequence of it. Numbers are scanned by character class and then tested
 * against `^(?:0|-?[1-9][0-9]*)$`, so a float is refused by name and never
 * rounded into an integer. Strings are scanned one UTF-16 unit at a time, with
 * `\uXXXX` surrogate pairing handled inline, because an unpaired surrogate
 * escape has to be refused before it becomes a string that cannot survive
 * UTF-8.
 *
 * The parser here is not JSON.parse. It has to be stricter in three ways that
 * matter for a signed format, and a tree-walking implementation is the only
 * way to see all three:
 *
 *   1. duplicate keys are rejected, because a reader that keeps the last one
 *      and a reader that keeps the first disagree about what was signed;
 *   2. numbers must be canonical integers, because "1", "1.0" and "1e0" are
 *      three byte sequences for one value;
 *   3. escapes must not encode unpaired surrogates, because those do not
 *      survive a round trip through UTF-8.
 *
 * Failed input never throws. Depth is refused at the ceiling *before* the next
 * level is entered, so recursion is bounded by the ceiling rather than by the
 * input, and an input that nests a hundred thousand deep returns a refusal
 * instead of exhausting the stack.
 *
 * Whitespace and key order are tolerated while parsing so that the caller can
 * say "this is well-formed JSON but not the canonical bytes for it" rather
 * than reporting a bare syntax error. That distinction is the difference
 * between a verdict a stranger can act on and one they cannot.
 *
 * Canonical form is a subset of RFC 8785 (JSON Canonicalization Scheme) with
 * three differences: integers only, keys sorted by code point (RFC 8785 sorts
 * by UTF-16 code unit), and a file is one canonical value followed by exactly
 * one LF. See SPEC.md section 4.
 *
 * @module verifier/canonical
 */

import { concat, utf8Decode, utf8Encode } from './bytes.js';
import { LIMITS } from './limits.js';
import { REASON } from './status.js';

/** The one byte that ends a canonical document. */
export const LF = new Uint8Array([0x0a]);

const INTEGER_LITERAL = /^(?:0|-?[1-9][0-9]*)$/;
const FOUR_HEX = /^[0-9a-fA-F]{4}$/;

class Cursor {
  /**
   * @param {string} text
   * @param {number} maxDepth
   */
  constructor(text, maxDepth) {
    this.text = text;
    this.at = 0;
    this.maxDepth = maxDepth;
    /** @type {{ reason_code: string, detail: string } | null} */
    this.violation = null;
  }

  /** Record the first violation only: later ones are consequences of it. */
  fail(reason_code, detail) {
    if (this.violation === null) {
      this.violation = { reason_code, detail };
    }
  }

  skipWhitespace() {
    while (this.at < this.text.length) {
      const code = this.text.charCodeAt(this.at);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
        this.at += 1;
      } else {
        return;
      }
    }
  }

  /** @returns {unknown} undefined means "a violation was recorded" */
  parseValue(depth) {
    if (depth > this.maxDepth) {
      this.fail(REASON.MALFORMED, `the value nests deeper than the declared limit of ${this.maxDepth}`);
      return undefined;
    }
    if (this.at >= this.text.length) {
      this.fail(REASON.MALFORMED, 'the input ends where a value was expected');
      return undefined;
    }
    const char = this.text[this.at];
    if (char === '{') return this.parseObject(depth);
    if (char === '[') return this.parseArray(depth);
    if (char === '"') return this.parseString();
    if (char === 't') return this.parseLiteral('true', true);
    if (char === 'f') return this.parseLiteral('false', false);
    if (char === 'n') return this.parseLiteral('null', null);
    if (char === '-' || (char >= '0' && char <= '9')) return this.parseNumber();
    this.fail(REASON.MALFORMED, `character ${this.at + 1} cannot begin a JSON value`);
    return undefined;
  }

  parseLiteral(word, value) {
    if (this.text.startsWith(word, this.at)) {
      this.at += word.length;
      return value;
    }
    this.fail(REASON.MALFORMED, `expected ${word} at character ${this.at + 1}`);
    return undefined;
  }

  parseNumber() {
    const start = this.at;
    while (this.at < this.text.length && /[-+0-9.eE]/.test(this.text[this.at])) {
      this.at += 1;
    }
    const literal = this.text.slice(start, this.at);
    if (!INTEGER_LITERAL.test(literal)) {
      this.fail(REASON.NON_INTEGER_NUMBER, `${literal} is not a canonical integer (no fraction, no exponent, no leading zero, no negative zero)`);
      return undefined;
    }
    const value = Number(literal);
    if (!Number.isSafeInteger(value)) {
      this.fail(REASON.NUMBER_OUT_OF_RANGE, `${literal} exceeds the range an integer can round-trip through this format`);
      return undefined;
    }
    return value;
  }

  parseString() {
    this.at += 1;
    let out = '';
    for (;;) {
      if (this.at >= this.text.length) {
        this.fail(REASON.MALFORMED, 'a string is not closed');
        return undefined;
      }
      const code = this.text.charCodeAt(this.at);
      if (code === 0x22) {
        this.at += 1;
        return out;
      }
      if (code === 0x5c) {
        this.at += 1;
        const escape = this.text[this.at];
        this.at += 1;
        if (escape === '"' || escape === '\\' || escape === '/') {
          out += escape;
        } else if (escape === 'b') {
          out += '\b';
        } else if (escape === 'f') {
          out += '\f';
        } else if (escape === 'n') {
          out += '\n';
        } else if (escape === 'r') {
          out += '\r';
        } else if (escape === 't') {
          out += '\t';
        } else if (escape === 'u') {
          const digits = this.text.slice(this.at, this.at + 4);
          if (!FOUR_HEX.test(digits)) {
            this.fail(REASON.MALFORMED, `a \\u escape is not followed by four hexadecimal digits (at ${this.at})`);
            return undefined;
          }
          this.at += 4;
          const unit = Number.parseInt(digits, 16);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const paired = this.tryParseLowSurrogate();
            if (paired === null) {
              this.fail(REASON.MALFORMED, `the high surrogate escape \\u${digits} is not followed by a low surrogate escape`);
              return undefined;
            }
            out += String.fromCharCode(unit, paired);
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            this.fail(REASON.MALFORMED, `the low surrogate escape \\u${digits} has no preceding high surrogate escape`);
            return undefined;
          } else {
            out += String.fromCharCode(unit);
          }
        } else {
          this.fail(REASON.MALFORMED, `\\${escape === undefined ? 'end of input' : escape} is not a JSON escape`);
          return undefined;
        }
        continue;
      }
      if (code < 0x20) {
        this.fail(REASON.MALFORMED, `an unescaped control character (U+${code.toString(16).padStart(4, '0')}) appears inside a string`);
        return undefined;
      }
      out += this.text[this.at];
      this.at += 1;
    }
  }

  /**
   * Consume `\uXXXX` if it is a low surrogate.
   *
   * @returns {number | null} null leaves the cursor where it was
   */
  tryParseLowSurrogate() {
    if (this.text[this.at] !== '\\' || this.text[this.at + 1] !== 'u') return null;
    const digits = this.text.slice(this.at + 2, this.at + 6);
    if (!FOUR_HEX.test(digits)) return null;
    const unit = Number.parseInt(digits, 16);
    if (unit < 0xdc00 || unit > 0xdfff) return null;
    this.at += 6;
    return unit;
  }

  /** @returns {unknown} */
  parseObject(depth) {
    const object = Object.create(null);
    this.at += 1;
    this.skipWhitespace();
    if (this.text[this.at] === '}') {
      this.at += 1;
      return object;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.at] !== '"') {
        this.fail(REASON.MALFORMED, `an object key at character ${this.at + 1} is not a string`);
        return undefined;
      }
      const key = this.parseString();
      if (key === undefined) return undefined;
      if (key in object) {
        this.fail(REASON.DUPLICATE, `the key "${key}" appears more than once in the same object`);
        return undefined;
      }
      this.skipWhitespace();
      if (this.text[this.at] !== ':') {
        this.fail(REASON.MALFORMED, `a colon is missing after the key "${key}"`);
        return undefined;
      }
      this.at += 1;
      this.skipWhitespace();
      const value = this.parseValue(depth + 1);
      if (value === undefined) return undefined;
      object[key] = value;
      this.skipWhitespace();
      const next = this.text[this.at];
      if (next === ',') {
        this.at += 1;
        continue;
      }
      if (next === '}') {
        this.at += 1;
        return object;
      }
      this.fail(REASON.MALFORMED, `the member "${key}" is followed by neither a comma nor a closing brace`);
      return undefined;
    }
  }

  /** @returns {unknown} */
  parseArray(depth) {
    const items = [];
    this.at += 1;
    this.skipWhitespace();
    if (this.text[this.at] === ']') {
      this.at += 1;
      return items;
    }
    for (;;) {
      this.skipWhitespace();
      const value = this.parseValue(depth + 1);
      if (value === undefined) return undefined;
      items.push(value);
      this.skipWhitespace();
      const next = this.text[this.at];
      if (next === ',') {
        this.at += 1;
        continue;
      }
      if (next === ']') {
        this.at += 1;
        return items;
      }
      this.fail(REASON.MALFORMED, `item ${items.length} is followed by neither a comma nor a closing bracket`);
      return undefined;
    }
  }
}

/**
 * Parse one canonical JSON document from text.
 *
 * Tolerates surrounding whitespace and any key order; the caller decides
 * whether the bytes are canonical by comparing against the serialization.
 *
 * @param {string} text
 * @param {number} [maxDepth]
 * @returns {{ ok: true, value: unknown } | { ok: false, reason_code: string, detail: string }}
 */
export function parseJsonText(text, maxDepth = LIMITS.MAX_JSON_DEPTH) {
  const cursor = new Cursor(text, maxDepth);
  cursor.skipWhitespace();
  const value = cursor.parseValue(0);
  if (cursor.violation !== null) {
    return { ok: false, reason_code: cursor.violation.reason_code, detail: cursor.violation.detail };
  }
  cursor.skipWhitespace();
  if (cursor.at !== text.length) {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `content follows the top-level value at index ${cursor.at}` };
  }
  return { ok: true, value };
}

/**
 * Parse one canonical JSON document from the bytes a container held.
 *
 * The ceiling is checked before the bytes are decoded, so an oversize document
 * costs a length comparison rather than a decode, a parse, and whatever the
 * caller would have done with the result. Refusing early is the whole point of
 * a declared limit: a document too large to check is not a document this
 * verifier has checked, and saying so is not the same as saying it is fine.
 *
 * @param {Uint8Array} bytes
 * @param {{ limits?: typeof LIMITS, maxDepth?: number, maxBytes?: number }} [options]
 * @returns {{ ok: true, value: unknown } | { ok: false, reason_code: string, detail: string }}
 */
export function parseJsonBytes(bytes, options = {}) {
  const limits = options.limits ?? LIMITS;
  const maxBytes = options.maxBytes ?? limits.MAX_JSON_DOCUMENT_BYTES;
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      reason_code: REASON.LIMIT_EXCEEDED,
      detail: `the document is ${bytes.length} bytes, above the declared limit of ${maxBytes} bytes for one JSON document`,
    };
  }
  const decoded = utf8Decode(bytes);
  if (!decoded.ok) {
    return { ok: false, reason_code: REASON.DECODE_ERROR, detail: 'the bytes are not valid UTF-8' };
  }
  return parseJsonText(decoded.text, options.maxDepth ?? limits.MAX_JSON_DEPTH);
}

/** Escapes that have a short form. Every other character is written literally, or as `\uXXXX` if it is a control character. */
const SHORT_ESCAPES = new Map([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

/**
 * Quote a string the one way this format allows.
 *
 * Escapes only where JSON requires one, plus the two characters that must be
 * escaped anywhere: `"` and `\`. Everything else above U+001F is literal, so
 * `/` is `/` and `é` is `é`. Other encodings of the same string (`\u00e9` for
 * `é`, `\/` for `/`) are well-formed JSON and are rejected as non-canonical.
 *
 * @param {string} text
 * @returns {string}
 */
export function quoteString(text) {
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const short = SHORT_ESCAPES.get(code);
    if (short !== undefined) {
      out += short;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += text[i];
    }
  }
  return `${out}"`;
}

/**
 * Compare two strings by Unicode code point.
 *
 * Code point order, not UTF-16 code unit order: they disagree for the range
 * above U+FFFF against U+E000..U+FFFF, and the specification says code point.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareByCodePoint(a, b) {
  if (a === b) return 0;
  let i = 0;
  for (;;) {
    const left = a.codePointAt(i);
    const right = b.codePointAt(i);
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left !== right) return left < right ? -1 : 1;
    i += left > 0xffff ? 2 : 1;
  }
}

/**
 * Serialize a value to its canonical text.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function serializeCanonical(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`canonical JSON holds integers only, got ${String(value)}`);
    }
    return String(value);
  }
  if (typeof value === 'string') return quoteString(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonical(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareByCodePoint);
    const members = keys.map((key) => `${quoteString(key)}:${serializeCanonical(value[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`canonical JSON holds no ${typeof value} values`);
}

/**
 * The signing input of an object: canonical text without a trailing LF.
 *
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function canonicalBytes(value) {
  return utf8Encode(serializeCanonical(value));
}

/**
 * The bytes a signature is computed over: the canonical form of the object
 * with its signature field removed, then one LF.
 *
 * The trailing LF is what stops a signature from being moved between two
 * places in a document whose canonical texts are a suffix of one another.
 *
 * @param {Record<string, unknown>} object
 * @param {string} signatureField
 * @returns {Uint8Array}
 */
export function signingInput(object, signatureField) {
  const copy = Object.create(null);
  for (const key of Object.keys(object)) {
    if (key !== signatureField) copy[key] = object[key];
  }
  return concat([canonicalBytes(copy), LF]);
}
