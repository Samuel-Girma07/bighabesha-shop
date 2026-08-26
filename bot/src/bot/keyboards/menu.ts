import { Keyboard } from 'grammy';

export function getMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text('🛍️ Browse Shop').text('📦 My Orders')
    .row()
    .text('👤 My Profile').text('🌐 Language')
    .row()
    .text('💬 Support Desk')
    .resized()
    .persistent();
}

export function getPhoneRegistrationKeyboard(): Keyboard {
  return new Keyboard()
    .requestContact('📱 Share Phone Number')
    .resized()
    .oneTime();
}
