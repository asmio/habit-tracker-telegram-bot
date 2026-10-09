import { isCheckedButton, toggleButtonLabel, toggleCallbackData, TOGGLE_CALLBACK_PATTERN } from './toggle-button';

describe('toggleCallbackData / TOGGLE_CALLBACK_PATTERN', () => {
  test('round-trips itemId and date through the callback_data string', () => {
    const data = toggleCallbackData(42, '2026-01-01');
    expect(data).toBe('toggle:42:2026-01-01');

    const match = TOGGLE_CALLBACK_PATTERN.exec(data);
    expect(match?.[1]).toBe('42');
    expect(match?.[2]).toBe('2026-01-01');
  });

  test('does not match an unrelated or malformed string', () => {
    expect(TOGGLE_CALLBACK_PATTERN.test('toggle:abc:2026-01-01')).toBe(false);
    expect(TOGGLE_CALLBACK_PATTERN.test('toggle:1:2026-1-1')).toBe(false);
    expect(TOGGLE_CALLBACK_PATTERN.test('trackers:item:1')).toBe(false);
  });
});

describe('toggleButtonLabel', () => {
  test('an unchecked item is plain text, unchanged', () => {
    expect(toggleButtonLabel('Зарядка', false)).toBe('Зарядка');
  });

  test('a checked item keeps the same text but gets the green "success" style', () => {
    expect(toggleButtonLabel('Зарядка', true)).toEqual({ text: 'Зарядка', style: 'success' });
  });
});

describe('isCheckedButton', () => {
  test('true only for a button styled "success"', () => {
    expect(isCheckedButton({ text: 'x', style: 'success', callback_data: 'y' })).toBe(true);
  });

  test('false for a plain button, a differently-styled button, or a disabled one', () => {
    expect(isCheckedButton({ text: 'x', callback_data: 'y' })).toBe(false);
    expect(isCheckedButton({ text: 'x', style: 'danger', callback_data: 'y' })).toBe(false);
    expect(isCheckedButton({ text: 'x', disabled: {} })).toBe(false);
  });
});
