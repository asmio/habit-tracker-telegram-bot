import type { InlineKeyboardButton } from 'grammy/types';

/** A label inside a keyboard, not a control: a `disabled` button does nothing when tapped. */
export function disabledButton(text: string): InlineKeyboardButton {
  return { text, disabled: {} };
}
