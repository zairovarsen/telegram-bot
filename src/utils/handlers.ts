import { sendMessage } from '@/lib/bot'
import { createModeration, getPayload } from '@/lib/openai'
import {
  COMPLETION_GENERATION_ERROR_MESSAGE,
  INSUFFICIENT_TOKENS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  MODERATION_ERROR_MESSAGE,
} from './constants'
import { updateUserTokens } from '@/lib/supabase'
import { getRedisClient } from '@/lib/redis'

export const handleError = async (
  chatId: number,
  messageId: number,
  err: unknown,
) => {
  const message = getErrorMessage(err)
  switch (message) {
    case MODERATION_ERROR_MESSAGE:
      await sendMessage(chatId, message, {
        reply_to_message_id: messageId,
      })
      break
    case INSUFFICIENT_TOKENS_MESSAGE:
      await sendMessage(chatId, message, {
        reply_to_message_id: messageId,
      })
      break
    default:
      await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
        reply_to_message_id: messageId,
      })
  }
}

/* Getting error message */
export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/* Insufficient tokens */
export const handleInsufficientTokens = async (
  totalTokensRemaining: number,
  estimatedTokensForRequest: number,
) => {
  if (totalTokensRemaining < estimatedTokensForRequest) {
    throw Error(INSUFFICIENT_TOKENS_MESSAGE)
  }
}

/* Supabase update user tokens and Redis update user tokens */
export const updateUserTokensInRedisAndDb = async (
  userId: number,
  totalTokens: number,
  tokensUsed: number,
) => {
  const userKey = `user:${userId}`
  const redisClient = getRedisClient()

  try {
    const newTokenCount = totalTokens - tokensUsed
    const redisMulti = redisClient.multi()
    redisMulti.hset(userKey, { tokens: newTokenCount })
    const redisResponse = await redisMulti.exec()

    if (!redisResponse) {
      throw new Error()
    }

    const updateDbTokens = await updateUserTokens(userId, newTokenCount)

    if (!updateDbTokens) {
      throw new Error()
    }
  } catch (err) {
    const redisRollback = redisClient.multi()
    redisRollback.hset(userKey, { tokens: totalTokens })
    await redisRollback.exec()

    throw new Error(INTERNAL_SERVER_ERROR_MESSAGE)
  }
}
