import { createReadStream } from 'fs'
import { convertToWav, getFileSizeInMb } from '@/utils/convertToWav'
import { processImagePromptOpenJourney } from '@/lib/image'
import { TelegramBot } from '@/types'
import { getRedisClient, hget, lock } from '@/lib/redis'
import { calculateWhisperTokens } from '@/utils/tokenizer'
import { getFile, sendDocument, sendMessage } from '@/lib/bot'
import {
  AUIDO_FILE_EXCEEDS_LIMIT_MESSAGE,
  INSUFFICIENT_TOKENS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  OPEN_AI_AUDIO_LIMIT,
  WORKING_ON_NEW_FEATURES_MESSAGE,
} from '@/utils/constants'
import { createTranslation } from '@/lib/openai'
import { updateUserTokens } from '@/lib/supabase'
import { processGeneralQuestion, processPdfQuestion } from '@/lib/question'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { handleError } from '@/utils/handlers'
import { handleAudioRequest } from './audio'
import { qStash } from './qstash'

export interface VoiceBody {
  message: TelegramBot.Message
  userId: number
  questionType: string
}

const handleQuestionType = async (
  questionType: string,
  question: string,
  message: TelegramBot.Message,
  userId: number,
  chatId: number,
  messageId: number,
) => {
  if (questionType == 'General Question') {
    const answer = await processGeneralQuestion(question, message, userId)
    if (answer) {
      await sendMessage(chatId, answer, { reply_to_message_id: messageId })
    }
  } else if (questionType == 'PDF Question') {
    return await processPdfQuestion(question, message, userId)
  } else if (questionType == 'Ask Steve Jobs') {
    await handleAudioRequest(
      userId,
      message,
      question,
      process.env.STEVE_JOBS_VOICE_ID as string,
    )
  } else if (questionType == 'Ask Ben Shapiro') {
    await handleAudioRequest(
      userId,
      message,
      question,
      process.env.BEN_SHAPIRO_VOICE_ID as string,
    )
  } else {
    const id = await processImagePromptOpenJourney(question)
    if (id) {
      try {
        const body = {
          message: message,
          userId,
          taskId: id,
        }

        const qStashPublishResponse = await qStash.publishJSON({
          url: `${process.env.QSTASH_URL}/midjourney` as string,
          body,
        })
        if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
        }
        console.log(`QStash Response: ${qStashPublishResponse.messageId}`)
      } catch (err) {
        console.error(err)
        await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        })
      }
    }
  }
}

/* Voice message handler */
export const processVoice = async (
  message: VoiceBody['message'],
  userId: VoiceBody['userId'],
  questionType: VoiceBody['questionType'],
): Promise<void> => {
  const {
    chat: { id: chatId },
    message_id: messageId,
  } = message
  if (questionType == 'Goal') {
    await sendMessage(chatId, WORKING_ON_NEW_FEATURES_MESSAGE, {
      reply_to_message_id: messageId,
    })
    return
  }
  console.log(`Question type: ${questionType}`)
  // convert audio to text and send to question completion, then delete audio
  // Acquire a lock on the user resource
  const key = `user:${userId}`
  const userLockResource = `locks:user:token:${userId}`
  const { duration, file_id } = message.voice as TelegramBot.Voice
  try {
    let unlock = await lock(userLockResource)

    try {
      const totalTokens = parseInt((await hget(key, 'tokens')) || '0')
      console.log(`Total tokens before request: `, totalTokens)
      const tokensToProcessAudio = calculateWhisperTokens(duration)

      if (totalTokens < tokensToProcessAudio) {
        await sendMessage(chatId, INSUFFICIENT_TOKENS_MESSAGE, {
          reply_to_message_id: messageId,
        })
        return
      }

      const file = await getFile(file_id)
      const file_path = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`
      if (!file_path) {
        await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        })
        return
      }
      console.log(`File path: ${file_path}`)
      const response = await fetch(file_path)
      const arrayBuffer = await response.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)

      const tempDir = os.tmpdir()
      const tempFilePath = path.join(tempDir, `${file_id}.oga`)
      fs.writeFileSync(tempFilePath, fileBuffer)

      const tempDir2 = os.tmpdir()
      const tempFilePath2 = path.join(tempDir2, `${file_id}.wav`)
      await convertToWav(tempFilePath, tempFilePath2)
      const fileSizeInMb = getFileSizeInMb(tempFilePath2)

      if (fileSizeInMb > OPEN_AI_AUDIO_LIMIT) {
        await sendMessage(chatId, AUIDO_FILE_EXCEEDS_LIMIT_MESSAGE, {
          reply_to_message_id: messageId,
        })
        return
      }

      const translationResponse = await createTranslation(
        createReadStream(tempFilePath2),
      )

      if (!translationResponse) {
        await handleError(chatId, messageId, 'Unable to process audio')
        return
      }

      // #NOTE: Update in DB
      // process audio updated token
      const newTokenCountTotal = totalTokens - tokensToProcessAudio

      // Update the user's token count in Supabase
      const updateUserTokensDB = await updateUserTokens(
        userId,
        newTokenCountTotal,
      )
      if (!updateUserTokensDB) {
        await handleError(chatId, messageId, 'Unable to update user tokens')
        return
      }

      const redisMulti = getRedisClient().multi() // Start a transaction
      redisMulti.hset(key, {
        tokens: newTokenCountTotal > 0 ? newTokenCountTotal : 0,
      })
      await redisMulti.exec()

      const { text: question } = translationResponse

      await handleQuestionType(
        questionType,
        question,
        message,
        userId,
        chatId,
        messageId,
      )
    } catch (err) {
      handleError(chatId, messageId, err)
      return
    } finally {
      // Release the lock
      await unlock()
    }
  } catch (err) {
    handleError(chatId, messageId, err)
    return
  }
}
