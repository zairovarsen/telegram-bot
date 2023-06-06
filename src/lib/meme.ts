import { GENERATED_MEME_MESSAGE, MEME_OPTIONS } from './../utils/constants'
import { TelegramBot } from '@/types'
import { hget, lock } from './redis'
import { sendDocument, sendMessage } from './bot'
import {
  CONTEXT_TOKENS_CUTOFF,
  INTERNAL_SERVER_ERROR_MESSAGE,
} from '@/utils/constants'
import { estimateEmbeddingTokens } from '@/utils/tokenizer'
import {
  handleCompletion,
  handleError,
  handleInsufficientTokens,
  handleModeration,
  updateUserTokensInRedisAndDb,
} from '@/utils/handlers'

export type MemeType = (typeof MEME_OPTIONS)[number]['name']

/**
 * Process PDF question using OpenAI completion and embeddings API
 *
 * @param text
 * @param message
 * @param userId
 * @returns
 */
export const processMemeGeneration = async (
  text: string,
  memeType: MemeType,
  message: TelegramBot.Message,
  userId: number,
): Promise<void> => {
  const userKey = `user:${userId}`
  const userLockResource = `locks:user:token:${userId}`
  const {
    chat: { id: chatId },
    message_id: messageId,
  } = message

  try {
    let unlock
    try {
      unlock = await lock(userLockResource)
    } catch (err) {
      console.error('Error acquiring lock', err)
      // Consider implementing retry logic here, or a specific error message.
      return
    }

    try {
      const totalTokensRemaining = parseInt(
        (await hget(userKey, 'tokens')) || '0',
      )

      const sanitizedInput = text.replace(/(\r\n|\n|\r)/gm, '')

      if (!sanitizedInput.trim()) {
        await sendMessage(chatId, 'Input is empty or contains whitespace', {
          reply_to_message_id: messageId,
        })
        return
      }

      await handleModeration(sanitizedInput)

      const estimatedTokensForEmbeddingsRequest =
        estimateEmbeddingTokens(sanitizedInput)

      await handleInsufficientTokens(
        totalTokensRemaining,
        estimatedTokensForEmbeddingsRequest + CONTEXT_TOKENS_CUTOFF + 500,
      )

      const prompt =
        `Return the two options for ${memeType} meme about: ` +
        sanitizedInput +
        '. do not return any explaination, just return the list. only return one list. make it funny.'

      const completion = await handleCompletion(prompt, false, [
        {
          role: 'system',
          content: `I am creating a ${memeType} meme. In this meme, Drake disapproves of the first option and approves of the second option. Please provide two short phrases or words for each option, where the first phrase represents a less desirable approach and the second phrase is the more desirable approach. Format your response as a Javascript list, like this: [option1, option2]`,
        },
        { role: 'user', content: prompt },
      ])

      await updateUserTokensInRedisAndDb(
        userId,
        totalTokensRemaining,
        completion?.usage?.total_tokens || 0,
      )

      const regex = /"((?:\\"|[^"])*)"/g

      const content = completion.choices[0].message?.content as string

      const match = content.match(regex)

      if (!match || match.length < 2) {
        console.error('No match found')
        sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        })
        return
      }

      const matches = match.map(match => match.slice(1, -1))

      const url = 'https://api.imgflip.com/caption_image'

      const imgFlipPayload = {
        template_id: MEME_OPTIONS.find(meme => meme.name === memeType)
          ?.template_id as string,
        username: process.env.IMG_FLIP_USERNAME as string,
        password: process.env.IMG_FLIP_PASSWORD as string,
        text0: matches[0],
        text1: matches[1],
        font: 'impact',
        max_font_size: '50',
      }

      const formBody = new URLSearchParams(imgFlipPayload).toString()

      const imgFlipUploadResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody,
      })

      const new_image = await imgFlipUploadResponse.json()

      if (!new_image.success) {
        console.error('ImgFlip upload error: ', new_image)
        await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        })
        return
      }

      await sendDocument(chatId, new_image.data.url, {
        caption: GENERATED_MEME_MESSAGE,
        reply_to_message_id: messageId,
      })
    } catch (err) {
      await handleError(chatId, messageId, err)
    } finally {
      // Release the lock
      await unlock()
    }
  } catch (err) {
    await handleError(chatId, messageId, err)
  }
}
