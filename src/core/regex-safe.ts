/**
 * Lightweight ReDoS guard (review §6.4).
 *
 * JavaScript offers no way to interrupt a synchronously-running regular
 * expression, so a user-supplied assertion regex with nested quantifiers
 * (e.g. `(a+)+$`, `(\\w*)*`) could hang a test run. We cannot decide ReDoS
 * statically in general, so this is a conservative heuristic that flags the
 * classic catastrophic shapes. It errs toward refusing only obvious cases.
 */

// A group that itself contains a quantifier, followed by another quantifier:
//   (a+)+   (.*)*   (\w+)?{2,}   ([a-z])+
const NESTED_QUANTIFIER = /\([^()]*[+*?][^()]*\)\s*(?:[+*?]|\{\d+,?\d*\})/;

// Adjacent overlapping quantified tokens around an alternation, e.g. (a|a)* is
// not caught above without inner quantifier — kept simple and conservative.

export function isLikelyCatastrophic(pattern: string): boolean {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  return NESTED_QUANTIFIER.test(pattern);
}

/** Compile a user regex, throwing a descriptive error for bad/unsafe patterns. */
export function compileUserRegex(pattern: string): RegExp {
  if (isLikelyCatastrophic(pattern)) {
    throw new Error(
      `refused potentially catastrophic (ReDoS) regex /${pattern}/: nested quantifiers can hang the process; rewrite without a quantified group followed by another quantifier`,
    );
  }
  return new RegExp(pattern);
}
