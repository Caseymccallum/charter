/**
 * The report builder.
 *
 * A verdict is assembled through this class and nowhere else. It refuses an
 * unknown check id, an unknown status, an unknown reason code, and a second
 * result for the same check. That is what makes "every check appears exactly
 * once in every verdict" a property of the code rather than a promise in a
 * document.
 *
 * @module verifier/result
 */

import { CHECK_REGISTRY, EXIT_CODE, REASON, STATUS, VERDICT } from './status.js';

const STATUS_VALUES = new Set(Object.values(STATUS));
const REASON_VALUES = new Set(Object.values(REASON));

export class Reporter {
  /**
   * @param {readonly import('./status.js').CheckDefinition[]} [registry]
   */
  constructor(registry = CHECK_REGISTRY) {
    /** @type {Map<string, import('./status.js').CheckDefinition>} */
    this.definitions = new Map();
    /** @type {Map<string, import('./status.js').CheckResult>} */
    this.results = new Map();
    for (const definition of registry) {
      if (this.definitions.has(definition.id)) {
        throw new TypeError(`duplicate check id in registry: ${definition.id}`);
      }
      this.definitions.set(definition.id, definition);
      this.results.set(definition.id, null);
    }
  }

  /**
   * Record one result. Every other method here funnels through this one.
   *
   * @param {string} id
   * @param {string} status
   * @param {string} reason_code
   * @param {string} detail
   * @returns {void}
   */
  set(id, status, reason_code, detail) {
    const definition = this.definitions.get(id);
    if (definition === undefined) {
      throw new TypeError(`unknown check id: ${id}`);
    }
    if (!STATUS_VALUES.has(status)) {
      throw new TypeError(`unknown status: ${status}`);
    }
    if (!REASON_VALUES.has(reason_code)) {
      throw new TypeError(`unknown reason code: ${reason_code}`);
    }
    if (this.results.get(id) !== null) {
      throw new TypeError(`check reported twice: ${id}`);
    }
    if (typeof detail !== 'string' || detail.length === 0) {
      throw new TypeError(`check detail must be a non-empty string: ${id}`);
    }
    this.results.set(id, {
      id,
      level: definition.level,
      status,
      reason_code,
      detail,
      requirement: definition.requirement,
    });
  }

  /** @param {string} id @param {string} detail */
  pass(id, detail) {
    this.set(id, STATUS.PASS, REASON.OK, detail);
  }

  /** @param {string} id @param {string} reason_code @param {string} detail */
  fail(id, reason_code, detail) {
    this.set(id, STATUS.FAIL, reason_code, detail);
  }

  /** @param {string} id @param {string} reason_code @param {string} detail */
  unsupported(id, reason_code, detail) {
    this.set(id, STATUS.UNSUPPORTED, reason_code, detail);
  }

  /** @param {string} id @param {string} detail @param {string} [reason_code] */
  skip(id, detail, reason_code = REASON.PREREQUISITE_FAILED) {
    this.set(id, STATUS.SKIP, reason_code, detail);
  }

  /**
   * Mark every check whose id starts with `prefix` and that has no result yet
   * as SKIP. Used to propagate the consequences of a failed prerequisite
   * without either forgetting a check or reporting one twice.
   *
   * @param {string} prefix
   * @param {string} detail
   * @param {string} [reason_code]
   * @returns {string[]} the ids that were skipped
   */
  skipUnset(prefix, detail, reason_code = REASON.PREREQUISITE_FAILED) {
    const skipped = [];
    for (const id of this.results.keys()) {
      if (id.startsWith(prefix) && this.results.get(id) === null) {
        this.skip(id, detail, reason_code);
        skipped.push(id);
      }
    }
    return skipped;
  }

  /** @param {string} id @returns {boolean} */
  passed(id) {
    const result = this.results.get(id);
    return result !== null && result.status === STATUS.PASS;
  }

  /** @param {string} id @returns {string | null} */
  statusOf(id) {
    const result = this.results.get(id);
    return result === null ? null : result.status;
  }

  /**
   * @returns {import('./status.js').CheckResult[]} results in registry order
   */
  all() {
    const out = [];
    for (const [id, result] of this.results) {
      if (result === null) {
        throw new Error(`no result recorded for check: ${id}`);
      }
      out.push(result);
    }
    return out;
  }
}

/**
 * The verdict over a complete list of results.
 *
 * A single FAIL makes the artifact BROKEN. With no FAIL, any SKIP or
 * UNSUPPORTED leaves the artifact unproven (INCOMPLETE). Only an all-PASS list
 * earns VERIFIED. An empty list can never be VERIFIED, which is deliberate: a
 * check that never ran is not a check that passed.
 *
 * @param {readonly import('./status.js').CheckResult[]} checks
 * @returns {{ verdict: string, exit_code: number, summary: { pass: number, fail: number, unsupported: number, skip: number, total: number } }}
 */
export function resolve(checks) {
  const summary = { pass: 0, fail: 0, unsupported: 0, skip: 0, total: checks.length };
  for (const check of checks) {
    if (check.status === STATUS.PASS) summary.pass += 1;
    else if (check.status === STATUS.FAIL) summary.fail += 1;
    else if (check.status === STATUS.UNSUPPORTED) summary.unsupported += 1;
    else summary.skip += 1;
  }
  if (summary.fail > 0) {
    return { verdict: VERDICT.BROKEN, exit_code: EXIT_CODE.BROKEN, summary };
  }
  if (summary.total === 0 || summary.skip > 0 || summary.unsupported > 0) {
    return { verdict: VERDICT.INCOMPLETE, exit_code: EXIT_CODE.INCOMPLETE, summary };
  }
  return { verdict: VERDICT.VERIFIED, exit_code: EXIT_CODE.VERIFIED, summary };
}
