import { backButton, confirmKeyboard } from './tracker-picker';

test('backButton is a "← Назад" callback button to the given route', () => {
  expect(backButton('trackers:list')).toEqual({ text: '← Назад', callback_data: 'trackers:list' });
});

describe('confirmKeyboard', () => {
  test('without a back route, it is a single confirm button on its own row', () => {
    const kb = confirmKeyboard('🗑 Да', 'trackers:deltrackerconfirm:1');
    expect(kb.inline_keyboard).toEqual([[{ text: '🗑 Да', callback_data: 'trackers:deltrackerconfirm:1' }]]);
  });

  test('with a back route, "← Назад" joins the confirm button on the same row', () => {
    const kb = confirmKeyboard('🗑 Да', 'trackers:deltrackerconfirm:1', 'trackers:open:1');
    expect(kb.inline_keyboard).toEqual([
      [
        { text: '🗑 Да', callback_data: 'trackers:deltrackerconfirm:1' },
        { text: '← Назад', callback_data: 'trackers:open:1' },
      ],
    ]);
  });
});
