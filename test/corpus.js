/**
 * The corpus of text the canonical reader is fuzzed with.
 *
 * It lives here, apart from the tests that use it, because two properties are
 * stated over the same corpus and a corpus is only evidence if it is the same
 * corpus. `test/parser.fuzz.test.js` asks whether any of it makes the parser
 * throw, or makes it accept something it should refuse, and whether the whole
 * verifier survives it. `test/canonical.roundtrip.test.js` asks what the
 * serializer does with everything the parser accepts, and whether every string
 * here survives the trip from a value back to bytes.
 *
 * The entries are grouped the way the mistakes are: truncations and dangling
 * punctuation, tokens that are not JSON at all, number spellings that are not
 * canonical integers, control characters where they are not allowed, lone
 * surrogates, and one document that is two documents. Most are refused and a
 * few are accepted, and the interesting question is always which — so the
 * entries carry no expectation of their own. Each one is a string a reader
 * could be handed, which is the only qualification a corpus needs.
 *
 * @module test/corpus
 */

export const HOSTILE_TEXT = [
  '',
  ' ',
  '\n',
  '\uFEFF{}',
  '{}',
  '{} {}',
  '[]',
  '[',
  ']',
  '{',
  '}',
  '{,}',
  '[,]',
  '[1,]',
  '{"a":}',
  '{"a"1}',
  '{"a":1,}',
  '{"a":1',
  '"',
  '"\\',
  '"\\u',
  '"\\uZZZZ"',
  '"\\q"',
  'tru',
  'true false',
  'null0',
  'undefined',
  'NaN',
  'Infinity',
  '0x10',
  '1_000',
  "'a'",
  '{"a":1}\u0000',
  '"\u0000"',
  '[[]]extra',
  '{"\\ud83d":1}',
  '{"a":1}{"b":2}',
  '-',
  '-.5',
  '1.2.3',
  '1e',
  '1e+',
  '1E-',
  `${'['.repeat(1000)}${'x'.repeat(1000)}`,
  '\ud800',
  '{"\ud800":1}',
  '["\\ud800\\udc00\\ud800"]',
];
