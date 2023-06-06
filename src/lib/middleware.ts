import { TelegramBot, UserInfoCache } from '@/types'
import {
  AllowedTelegramUsers,
  INITIAL_IMAGE_GENERATION_COUNT,
  INITIAL_TOKEN_COUNT,
} from '@/utils/constants'
import { del, hgetAll, hmset } from '@/lib/redis'
import { createNewUser, getUserDataFromDatabase } from '@/lib/supabase'

export const isMe = (user: TelegramBot.User): boolean =>
  user && AllowedTelegramUsers.includes(user.id)

export const isBot = (user: TelegramBot.User): boolean =>
  user ? user.is_bot : false

export const hasValidFromField = (update: TelegramBot.Message): boolean => {
  return update?.from !== undefined
}

export const getUser = (
  update: TelegramBot.CustomUpdate,
): TelegramBot.User | null => {
  if (update.message) {
    return update.message.from || null
  } else if (update.callback_query) {
    return update.callback_query.from
  } else if (update.pre_checkout_query) {
    return update.pre_checkout_query.from
  }
  return null
}

async function getUserData(key: string): Promise<UserInfoCache | null> {
  try {
    const data = await hgetAll(key)
    if (!data) return null

    return {
      tokens: parseInt((data.tokens as string) || '0'),
      image_generations_remaining: parseInt(
        (data.image_generations_remaining as string) || '0',
      ),
    }
  } catch (err) {
    console.error('Error getting user data from cache', err)
    return null
  }
}

export const isNonNullUser = (
  user: TelegramBot.User | null,
): user is TelegramBot.User => {
  return user !== null
}

export const middleware = async (
  update: TelegramBot.CustomUpdate,
): Promise<boolean> => {
  const user = getUser(update)
  if (!isNonNullUser(user) || isBot(user) || !isMe(user)) return false

  const { id: user_id, first_name, last_name } = user
  const key = `user:${user_id}`
  let userDataCache = await getUserData(key)

  // remove goals from cache if user doesn't press yes
  if (
    !update.callback_query ||
    (update.callback_query.data !== 'Yes' &&
      update.callback_query.data !== 'No')
  ) {
    try {
      await del(`goal:${user_id}`)
    } catch (err) {
      console.error('Error deleting goal from cache', err)
    }
  }

  if (!userDataCache || Object.keys(userDataCache).length === 0) {
    let userDataFromDB = await getUserDataFromDatabase(user_id)

    if (!userDataFromDB) {
      userDataFromDB = await createNewUser({
        user_id,
        first_name,
        last_name,
        image_generation_total: INITIAL_IMAGE_GENERATION_COUNT,
        image_generations_remaining: INITIAL_IMAGE_GENERATION_COUNT,
        tokens: INITIAL_TOKEN_COUNT,
      })
      if (!userDataFromDB) {
        console.error('Error creating new user')
        return false
      }
    }

    try {
      await hmset(key, {
        tokens: userDataFromDB.tokens,
        image_generations_remaining: userDataFromDB.image_generations_remaining,
      })
    } catch (err) {
      console.error('Error setting user data in cache', err)
    }

    update.userData = {
      tokens: userDataFromDB.tokens || 0,
      image_generations_remaining:
        userDataFromDB.image_generations_remaining || 0,
    }
  } else {
    update.userData = {
      tokens: userDataCache.tokens || 0,
      image_generations_remaining:
        userDataCache.image_generations_remaining || 0,
    }
  }

  return true
}
