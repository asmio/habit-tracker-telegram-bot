import { backToHomeButton, HOME_CALLBACK_DATA, SETTINGS_CALLBACK_DATA } from './nav';

test('HOME_CALLBACK_DATA and SETTINGS_CALLBACK_DATA are distinct routes', () => {
  expect(HOME_CALLBACK_DATA).toBe('home');
  expect(SETTINGS_CALLBACK_DATA).toBe('home:settings');
  expect(SETTINGS_CALLBACK_DATA).not.toBe(HOME_CALLBACK_DATA);
});

test('backToHomeButton points at HOME_CALLBACK_DATA', () => {
  const button = backToHomeButton();
  expect(button).toEqual({ text: '← Назад', callback_data: HOME_CALLBACK_DATA });
});
