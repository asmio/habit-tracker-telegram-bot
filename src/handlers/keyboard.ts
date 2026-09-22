import { Keyboard } from 'grammy';

export const MAIN_MENU_KEYBOARD = new Keyboard()
  .text('📋 Сегодня')
  .text('➕ Новый трекер')
  .text('✏️ Управление')
  .resized()
  .persistent();

export const MAIN_MENU_TEXT = '📌 Главное меню';
