import type { InlineKeyboardButton } from 'grammy/types';

/** Matches `toggle:{itemId}:{date}`; the capture groups are the item id and the `YYYY-MM-DD` date. */
export const TOGGLE_CALLBACK_PATTERN = /^toggle:(\d+):(\d{4}-\d{2}-\d{2})$/;

export function toggleCallbackData(itemId: number, date: string): string {
  return `toggle:${itemId}:${date}`;
}

export function toggleButtonLabel(label: string, checked: boolean): string | { text: string; style: 'success' } {
  return checked ? { text: label, style: 'success' } : label;
}

export function isCheckedButton(button: InlineKeyboardButton): boolean {
  return 'style' in button && button.style === 'success';
}
