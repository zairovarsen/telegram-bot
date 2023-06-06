// Image generation endpoint for QStash
import { NextApiRequest, NextApiResponse } from 'next'
import { sendDocument, sendMessage } from '@/lib/bot'
import { GENERATED_IMAGE_MESSAGE } from '@/utils/constants'
import {
  ImageBody,
  processImage,
  processImagePromptOpenJourney,
} from '@/lib/image'
import { verifySignature } from '@upstash/qstash/nextjs'
import { ConversionModel } from '@/types'

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body
  const startTime = performance.now()

  const { message, userId, conversionModel } = body as ImageBody
  const {
    chat: { id: chatId },
    message_id: messageId,
  } = message

  let image
  if (conversionModel == ConversionModel.OPENJOURNEY) {
    const { text } = body
    image = await processImagePromptOpenJourney(text, userId)
  } else {
    image = await processImage(message, userId, conversionModel)
  }

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
  const endTime = performance.now()
  const elapsedTime = endTime - startTime
  console.log(`Elapsed time: ${elapsedTime} ms`)
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
