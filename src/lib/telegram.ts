import CryptoJS from 'crypto-js';

/**
 * Validates the Telegram Mini App initData string.
 * @param initData The initData string from the Telegram Web App.
 * @param botToken The secret token of your Telegram bot.
 * @returns The parsed user data object if validation is successful, otherwise throws an error.
 */
export function validateInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  
  if (!hash) {
    throw new Error('Invalid initData: Hash is missing');
  }

  // The 'hash' parameter should be removed from the data-check-string.
  params.delete('hash');
  
  // The remaining parameters are sorted alphabetically by key.
  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys
    .map(key => `${key}=${params.get(key)}`)
    .join('\n');
    
  // The secret key is the HMAC-SHA256 hash of the bot token with the constant string "WebAppData".
  const secretKey = CryptoJS.HmacSHA256(botToken, "WebAppData");
  
  // The data-check-string is hashed using the HMAC-SHA256 algorithm with the secret key.
  const calculatedHash = CryptoJS.HmacSHA256(dataCheckString, secretKey).toString(CryptoJS.enc.Hex);

  if (calculatedHash !== hash) {
    throw new Error('Invalid initData: Hash does not match');
  }
  
  // If validation is successful, parse and return the user object.
  const userJson = params.get('user');
  if (!userJson) {
    throw new Error('Invalid initData: User data is missing');
  }

  return JSON.parse(userJson);
}
