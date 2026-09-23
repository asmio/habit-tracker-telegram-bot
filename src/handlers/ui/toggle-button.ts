const MARK_CHECKED = '☑';
const MARK_UNCHECKED = '☐';

/** Matches `toggle:{itemId}:{date}`; the capture groups are the item id and the `YYYY-MM-DD` date. */
export const TOGGLE_CALLBACK_PATTERN = /^toggle:(\d+):(\d{4}-\d{2}-\d{2})$/;

export function toggleCallbackData(itemId: number, date: string): string {
  return `toggle:${itemId}:${date}`;
}

export function toggleButtonText(label: string, checked: boolean): string {
  return `${checked ? MARK_CHECKED : MARK_UNCHECKED} ${label}`;
}

export function isCheckedButtonText(buttonText: string): boolean {
  return buttonText.startsWith(MARK_CHECKED);
}
