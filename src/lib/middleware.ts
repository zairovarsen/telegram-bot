import { TelegramBot, UserInfoCache } from "@/types";
import { AllowedTelegramUsers, INITIAL_IMAGE_GENERATION_COUNT, INITIAL_TOKEN_COUNT } from "@/utils/constants";
import { hgetAll, hmset } from "@/lib/redis";
import { createNewUser, getUserDataFromDatabase } from "@/lib/supabase";

export const isMe = (update: TelegramBot.CustomUpdate): boolean => {
    if (update.message) {
    return (update.message.from && AllowedTelegramUsers.includes(update.message?.from?.id)) || false
    } else if (update.callback_query) {
        return AllowedTelegramUsers.includes(update.callback_query.from.id);
    } else if (update.pre_checkout_query) {
        return AllowedTelegramUsers.includes(update.pre_checkout_query.from.id);
    } else {
        return false;
    }
}

export const isBot = (update: TelegramBot.CustomUpdate): boolean => {
    if (update.message) {
    return update.message?.from?.is_bot || false
  } else if (update.callback_query) {
    return update.callback_query.from.is_bot;
  } else if (update.pre_checkout_query) {
    return update.pre_checkout_query.from.is_bot;
  }
  return false;
}

export const hasValidFromField = (update: TelegramBot.Message): boolean => {
    return update?.from !== undefined;
}

export const getUser = (update: TelegramBot.CustomUpdate): TelegramBot.User | null => {
  if (update.message) {
    return (update.message.from) || null;
  } else if (update.callback_query) {
    return update.callback_query.from;
  } else if (update.pre_checkout_query) {
    return update.pre_checkout_query.from;
  }
  return null;
}

export const isNonNullUser = (user: TelegramBot.User | null): user is TelegramBot.User => {
  return user !== null;
}



async function getUserData(key: string): Promise<UserInfoCache | null> {
  const data = await hgetAll(key);
  if (!data) return null;

  const tempUserData = data as unknown as { tokens: string, image_generations_remaining: string };

   const userData:UserInfoCache = {
    tokens: parseInt(tempUserData.tokens),
    image_generations_remaining: parseInt(tempUserData.image_generations_remaining),
   }

  // Type assertion to convert Record<string, unknown> to UserData
  return userData as unknown as UserInfoCache;
}


export const middleware = async (update: TelegramBot.CustomUpdate): Promise<boolean> => {
    if (isBot(update)) return false;
    if (!isMe(update)) return false;
    if (update.message && !hasValidFromField(update.message)) return false;

    const user = getUser(update);
    if (!isNonNullUser(user)) return false;
    const {id: user_id, first_name, last_name} = user;
    const key = `user:${user_id}`;
    let userDataCache = await getUserData(key);

    if (!userDataCache || Object.keys(userDataCache).length === 0) {
        let userDataFromDB = await getUserDataFromDatabase(user_id);

         if (userDataFromDB) {
        await hmset(key, {
          tokens: userDataFromDB.tokens,
          image_generations_remaining:
            userDataFromDB.image_generations_remaining,
        });
      } else {
        userDataFromDB = await createNewUser({
          user_id,
          first_name,
          last_name,
          image_generation_total: INITIAL_IMAGE_GENERATION_COUNT,
          image_generations_remaining: INITIAL_IMAGE_GENERATION_COUNT,
          tokens: INITIAL_TOKEN_COUNT,
        });
        if (!userDataFromDB) {
          console.error("Error creating new user");
          return false;
        }
        await hmset(key, {
          tokens: userDataFromDB.tokens,
          image_generations_remaining:
            userDataFromDB.image_generations_remaining,
        });
      }
      update.userData = {
        tokens: userDataFromDB.tokens || 0,
        image_generations_remaining: 
          userDataFromDB.image_generations_remaining || 0
      
      };
    } else {
      update.userData = {
        tokens: userDataCache.tokens || 0,
        image_generations_remaining: userDataCache.image_generations_remaining || 0,
      };
    }

    return true;
}

