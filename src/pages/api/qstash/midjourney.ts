// Image generation endpoint for QStash
import { NextApiRequest, NextApiResponse } from 'next'
import { sendDocument, sendMessage } from '@/lib/bot'
import { GENERATED_IMAGE_MESSAGE } from '@/utils/constants'
import { verifySignature } from '@upstash/qstash/nextjs'
import { pollMidJourney } from '@/lib/image'

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body

  const { message, userId, taskId } = body
  const {
    chat: { id: chatId },
    message_id: messageId,
  } = message

  let image
  image = await pollMidJourney(userId, taskId)

  if (!image.success) {
    await sendMessage(chatId, image.errorMessage, {
      reply_to_message_id: messageId,
    })
  } else {
    const { fileUrl } = image
    await sendDocument(chatId, fileUrl, {
      caption: `\n${GENERATED_IMAGE_MESSAGE}. You have ${image.imageGenerationsRemaining} image generations remaining.`,
      reply_to_message_id: messageId,
    })
    console.log(
      `Remaining imageGenerations: ${image.imageGenerationsRemaining || 0}`,
    )
  }
  res.status(200).send('OK')
}

export const config = {
  api: {
    bodyParser: false,
  },
}

export default verifySignature(handler, {
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY as string,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY as string,
})
