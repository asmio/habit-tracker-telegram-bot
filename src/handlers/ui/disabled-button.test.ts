import { disabledButton } from './disabled-button';

test('wraps the text in a disabled button, with no callback_data of any kind', () => {
  const button = disabledButton('── 📋 Утро ──');
  expect(button).toEqual({ text: '── 📋 Утро ──', disabled: {} });
  expect('callback_data' in button).toBe(false);
});
