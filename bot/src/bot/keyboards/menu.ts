import { Keyboard, InlineKeyboard } from 'grammy';

export type ButtonStyle = 'primary' | 'success' | 'danger';

export interface StyledInlineButtonConfig {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
  style?: ButtonStyle;
  icon_custom_emoji_id?: string;
}

export interface StyledKeyboardButtonConfig {
  text: string;
  request_contact?: boolean;
  style?: ButtonStyle;
  icon_custom_emoji_id?: string;
}

/**
 * Creates a persistent reply keyboard matching the ergonomic bottom bar design:
 * [ 👤 My Account (Success Green) ]  [ 🏠 Main Menu (Primary Blue) ]
 */
export function getMainMenuKeyboard(lang: string = 'en'): Keyboard {
  const keyboard = new Keyboard();
  const isAmharic = lang === 'am';
  keyboard.add(
    {
      text: isAmharic ? '👤 የእኔ መረጃ' : '👤 My Account',
      style: 'success',
    } as any,
    {
      text: isAmharic ? '🏠 ዋና ማውጫ' : '🏠 Main Menu',
      style: 'primary',
    } as any
  );
  return keyboard.resized().persistent();
}

export function getPhoneRegistrationKeyboard(lang: string = 'en'): Keyboard {
  const keyboard = new Keyboard();
  const isAmharic = lang === 'am';
  keyboard.add({
    text: isAmharic ? '📱 ስልክ ቁጥር አጋራ' : '📱 Share Phone Number',
    request_contact: true,
    style: 'success',
  } as any);
  return keyboard.resized().oneTime();
}

/**
 * Helper to add a styled button to an InlineKeyboard
 */
export function addStyledInlineButton(
  keyboard: InlineKeyboard,
  config: StyledInlineButtonConfig
): InlineKeyboard {
  const btn: Record<string, any> = { text: config.text };
  if (config.callback_data) btn.callback_data = config.callback_data;
  if (config.url) btn.url = config.url;
  if (config.web_app) btn.web_app = config.web_app;
  if (config.style) btn.style = config.style;
  if (config.icon_custom_emoji_id) btn.icon_custom_emoji_id = config.icon_custom_emoji_id;

  return keyboard.add(btn as any);
}
