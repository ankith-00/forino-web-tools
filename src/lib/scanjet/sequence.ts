/**
 * Page-sequence rules for scanning a bound document two facing pages at a time.
 *
 * Every content page carries a QR whose value is its sequence number (1, 2, 3 …).
 * The book is scanned open, spine on the centre line, so each capture is a
 * spread: an odd page on the left and the next even page on the right
 * (1–2, 3–4, 5–6 …). After 3–4 the only acceptable spread is 5–6; anything
 * else is a wrong turn and the operator is told which pages to turn to.
 *
 * Ported unchanged from the ScanJet app (reactnative/src/lib/sequence.ts).
 * Pure TypeScript — no React and no React Native, so the same rules run in the
 * browser and under `node --test`.
 */

export type Pair = { left: number; right: number };

/** What the camera currently reads on each half of the frame; null = no QR on that half. */
export type Spread = { left: number | null; right: number | null };

export type SessionState = {
  /** Sequence number expected on the left page of the next spread. */
  nextLeft: number;
  /** Spreads accepted so far, in order. */
  accepted: Pair[];
  /** Set once the operator confirms the final (single) page. */
  finished: boolean;
};

export type Verdict =
  | { kind: 'waiting'; expected: Pair }
  /** Only one half has a QR, and it is the one expected there. */
  | { kind: 'partial'; side: 'left' | 'right'; value: number; expected: Pair }
  /** The expected spread: accept it. */
  | { kind: 'match'; pair: Pair }
  /** Still looking at a spread that was already accepted: turn the page. */
  | { kind: 'holding'; pair: Pair; expected: Pair }
  | { kind: 'wrong'; seen: Spread; expected: Pair; reason: WrongReason }
  | { kind: 'finished'; pages: number };

export type WrongReason =
  /** Pages before the expected spread (turned back, or scanned again). */
  | 'behind'
  /** Pages after the expected spread (a page was skipped). */
  | 'ahead'
  /** The two halves are not facing pages of one spread (e.g. 5 and 9). */
  | 'not_facing';

export const FIRST_LEFT = 1;

export function initialSession(): SessionState {
  return { nextLeft: FIRST_LEFT, accepted: [], finished: false };
}

export function expectedPair(state: SessionState): Pair {
  return { left: state.nextLeft, right: state.nextLeft + 1 };
}

function samePair(a: Pair | undefined, left: number | null, right: number | null): boolean {
  return !!a && a.left === left && a.right === right;
}

function inPair(a: Pair | undefined, value: number, side: 'left' | 'right'): boolean {
  return !!a && a[side] === value;
}

export function evaluate(state: SessionState, seen: Spread): Verdict {
  const expected = expectedPair(state);
  if (state.finished) return { kind: 'finished', pages: pagesScanned(state) };

  const { left, right } = seen;
  const last = state.accepted[state.accepted.length - 1];

  if (left === null && right === null) return { kind: 'waiting', expected };

  if (left !== null && right !== null) {
    if (left === expected.left && right === expected.right) return { kind: 'match', pair: expected };
    if (samePair(last, left, right)) return { kind: 'holding', pair: last!, expected };
    const reason: WrongReason =
      right !== left + 1 ? 'not_facing' : left < expected.left ? 'behind' : 'ahead';
    return { kind: 'wrong', seen, expected, reason };
  }

  // One half only: the page is turning, or the other QR is out of frame.
  const side = left !== null ? 'left' : 'right';
  const value = (left ?? right)!;
  if (value === expected[side]) return { kind: 'partial', side, value, expected };
  if (inPair(last, value, side)) return { kind: 'holding', pair: last!, expected };
  return { kind: 'wrong', seen, expected, reason: value < expected[side] ? 'behind' : 'ahead' };
}

export function accept(state: SessionState, pair: Pair): SessionState {
  return { ...state, nextLeft: pair.right + 1, accepted: [...state.accepted, pair] };
}

/**
 * The last page of a document with an odd page count has no facing page.
 * The operator confirms it; it is recorded as a spread with no right page (right = 0).
 */
export function finishOnLeft(state: SessionState): SessionState {
  const single: Pair = { left: state.nextLeft, right: 0 };
  return { ...state, nextLeft: state.nextLeft + 1, accepted: [...state.accepted, single], finished: true };
}

export function finish(state: SessionState): SessionState {
  return { ...state, finished: true };
}

export function pagesScanned(state: SessionState): number {
  return state.accepted.reduce((n, p) => n + (p.right ? 2 : 1), 0);
}

export function formatPair(p: Pair): string {
  return p.right ? `${p.left}–${p.right}` : `${p.left}`;
}

function formatSeen(s: Spread): string {
  if (s.left !== null && s.right !== null) return `${s.left}–${s.right}`;
  return `${s.left ?? s.right}`;
}

/** The one line shown to the operator for a verdict. */
export function message(v: Verdict): { tone: 'info' | 'ok' | 'error'; title: string; detail: string } {
  switch (v.kind) {
    case 'waiting':
      return {
        tone: 'info',
        title: `Open the document to pages ${formatPair(v.expected)}`,
        detail: 'Keep the spine on the centre line so each page sits in its own half.',
      };
    case 'partial':
      return {
        tone: 'info',
        title: `Page ${v.value} found`,
        detail: `Bring page ${v.side === 'left' ? v.expected.right : v.expected.left} into the ${v.side === 'left' ? 'right' : 'left'} half.`,
      };
    case 'match':
      return { tone: 'ok', title: `Pages ${formatPair(v.pair)} scanned`, detail: 'Turn the page.' };
    case 'holding':
      return {
        tone: 'ok',
        title: `Pages ${formatPair(v.pair)} scanned`,
        detail: `Turn the page to ${formatPair(v.expected)}.`,
      };
    case 'wrong': {
      const turn = `Please turn to pages ${formatPair(v.expected)}`;
      if (v.reason === 'not_facing') {
        return {
          tone: 'error',
          title: 'Scanning wrong: these pages do not face each other',
          detail: `Found ${v.seen.left} and ${v.seen.right}. ${turn}.`,
        };
      }
      return {
        tone: 'error',
        title: `Scanning wrong: ${turn}, not ${formatSeen(v.seen)}`,
        detail: v.reason === 'behind' ? 'These pages are already scanned. Turn forward.' : 'A page was skipped. Turn back.',
      };
    }
    case 'finished':
      return { tone: 'ok', title: 'Document complete', detail: `${v.pages} pages scanned in order.` };
  }
}
