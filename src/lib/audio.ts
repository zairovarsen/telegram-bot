import { TelegramBot } from '@/types'
import { sendAudio, sendMessage } from './bot'
import { processGeneralQuestion } from './question'
import { qStash } from './qstash'
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/utils/constants'

export interface AudioBody {
  message: TelegramBot.Message
  userId: number
  question: string
  voiceId: string
}

export async function handleAudioRequest(
  userId: number,
  message: TelegramBot.Message,
  question: string,
  voiceId: string,
) {
  try {
    const body = {
      message: message,
      userId,
      question,
      voiceId,
    }

    const qStashPublishResponse = await qStash.publishJSON({
      url: `${process.env.QSTASH_URL}/audio` as string,
      body,
    })
    if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
      await sendMessage(message.chat.id, INTERNAL_SERVER_ERROR_MESSAGE, {
        reply_to_message_id: message.message_id,
      })
    }
    console.log(`QStash Response: ${qStashPublishResponse.messageId}`)
  } catch (err) {
    console.error(err)
    await sendMessage(message.chat.id, INTERNAL_SERVER_ERROR_MESSAGE, {
      reply_to_message_id: message.message_id,
    })
  }
}

export const processAudio = async (
  message: AudioBody['message'],
  userId: AudioBody['userId'],
  question: AudioBody['question'],
  voiceId: AudioBody['voiceId'],
): Promise<void> => {
  const answer = await processGeneralQuestion(question, message, userId, true)
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVEN_LABS_API_KEY as string,
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: answer,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0,
          similarity_boost: 0,
        },
      }),
    },
  )

  console.log(`Eleven Labs Response: ${response.status}`)

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  await sendAudio(message.chat.id, buffer, {
    reply_to_message_id: message.message_id,
  })
}
