import { Keyboard } from 'grammy';

export const MAIN_MENU_KEYBOARD = new Keyboard()
  .text('📋 Сегодня')
  .text('➕ Новый трекер')
  .resized()
  .persistent();
