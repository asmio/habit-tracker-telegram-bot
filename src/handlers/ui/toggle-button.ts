const MARK_CHECKED = '☑';
const MARK_UNCHECKED = '☐';

/** Matches `toggle:{itemId}:{date}`; the capture groups are the item id and the `YYYY-MM-DD` date. */
export const TOGGLE_CALLBACK_PATTERN = /^toggle:(\d+):(\d{4}-\d{2}-\d{2})$/;

export function toggleCallbackData(itemId: number, date: string): string {
  return `toggle:${itemId}:${date}`;
}

/**
 * Braille blank (U+2800): not whitespace, so Telegram keeps it instead of trimming it, and roughly
 * as wide as an average letter -- which is what lets a character count stand in for a width.
 */
const PAD_CHAR = '\u2800';

/**
 * Longest label (in characters) that is still padded. A padded label that no longer fits a button
 * on one line would be cut off with "…", right after the invisible padding, so padding stops here;
 * a label longer than this is simply left as it is. Tune it against a real device.
 */
const MAX_ALIGNED_LABEL_LENGTH = 24;

/**
 * Button text is always centered, so labels of different lengths would put their checkbox at
 * different x positions. Padding every label at its end up to `alignTo` (the longest label on the
 * screen) evens that out -- only approximately, as fonts are proportional and clients differ. The
 * padding goes at the end so the checkbox stays the first character (see `isCheckedButtonText`).
 */
export function toggleButtonText(label: string, checked: boolean, alignTo = 0): string {
  const missing = Math.min(alignTo, MAX_ALIGNED_LABEL_LENGTH) - [...label].length;
  const padded = missing > 0 ? label + PAD_CHAR.repeat(missing) : label;
  return `${checked ? MARK_CHECKED : MARK_UNCHECKED} ${padded}`;
}

export function isCheckedButtonText(buttonText: string): boolean {
  return buttonText.startsWith(MARK_CHECKED);
}
