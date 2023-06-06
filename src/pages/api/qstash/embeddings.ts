// // Embeddings generation endpoint for QStash
import { verifySignature } from '@upstash/qstash/nextjs'
import { NextApiRequest, NextApiResponse } from 'next'
import { getFile, sendMessage } from '@/lib/bot'
import {
  ERROR_GENERATING_EMBEDDINGS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  PDF_PROCESSING_SUCCESS_MESSAGE,
  UNABLE_TO_PROCESS_PDF_MESSAGE,
} from '@/utils/constants'
import { PdfBody, processPdf } from '@/lib/pdf'

import { performance } from 'perf_hooks'

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body
  const startTime = performance.now()

  try {
    const { chatId, messageId, userId, fileId } = body as PdfBody

    const file = await getFile(fileId)
    const pdfPath = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`
    const embeddingsResult = await processPdf(pdfPath, userId)

    if (!embeddingsResult.success) {
      let message = ''
      console.log(embeddingsResult.errorMessage)
      if (
        embeddingsResult.errorMessage &&
        typeof embeddingsResult.errorMessage === 'string'
      ) {
        message += embeddingsResult.errorMessage
      } else if (
        embeddingsResult.errorMessage &&
        Array.isArray(embeddingsResult.errorMessage)
      ) {
        message += `${ERROR_GENERATING_EMBEDDINGS_MESSAGE}\n\n`
        message += embeddingsResult.errorMessage.join('\n')
        message += '\n'
        message +=
          'Please review the errors and consider making necessary adjustments to your file before trying again. If you have any questions or need assistance, feel free to reach out to our support team.'
      } else {
        message = UNABLE_TO_PROCESS_PDF_MESSAGE
      }
      await sendMessage(chatId, message, {
        reply_to_message_id: messageId,
      })
      res.status(200).send('OK')
      return
    }

    const endTime = performance.now()
    const elapsedTime = endTime - startTime
    console.log(`Elapsed time: ${elapsedTime} ms`)

    console.log(`Remaining tokens: ${embeddingsResult.tokenCount}`)
    await sendMessage(chatId, PDF_PROCESSING_SUCCESS_MESSAGE, {
      reply_to_message_id: messageId,
    })
    res.status(200).send('OK')
  } catch (err) {
    console.error(err)
    res.status(500).send(INTERNAL_SERVER_ERROR_MESSAGE)
  }
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
