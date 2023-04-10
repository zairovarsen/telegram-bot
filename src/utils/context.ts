import { safeGetObject, set } from "@/lib/redis";
import { CustomTelegramContext } from "@/types";

export type Context = Pick<CustomTelegramContext, "userData">;

/**
 * Save telegraf context to redis
 *
 * @param chatId
 * @param messageId
 * @param ctx
 * @returns true if saved successfully or false
 */
export const saveTelegrafContext = async (
  chatId: number,
  messageId: number,
  ctx: Context
): Promise<boolean> => {
  const key = `telegrafContext:${chatId}:${messageId}`;
  const value = JSON.stringify(ctx);
  console.log(`Saving telegraf context to redis: ${value}`)
  try {
    await set(key, value);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

/**
 * Load telegraf context from redis
 * 
 * @param chatId 
 * @param messageId 
 * @returns context or null
 */
export const loadTelegrafContext = async (
  chatId: number,
  messageId: number
): Promise<Context | null> => {
  const key = `telegrafContext:${chatId}:${messageId}`;
  console.log(key);
  try {
    const value = await safeGetObject<string>(key, "");
    if (!value) {
      return null;
    }
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error(error);
    return null;
  }
};
