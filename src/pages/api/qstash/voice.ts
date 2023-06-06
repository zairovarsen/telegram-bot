// // Embeddings generation endpoint for QStash
import { verifySignature } from '@upstash/qstash/nextjs'
import { NextApiRequest, NextApiResponse } from 'next'
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/utils/constants'

import { performance } from 'perf_hooks'
import { VoiceBody, processVoice } from '@/lib/voice'

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body
  const startTime = performance.now()

  try {
    const { message, userId, questionType } = body as VoiceBody
    await processVoice(message, userId, questionType)

    const endTime = performance.now()
    const elapsedTime = endTime - startTime
    console.log(`Elapsed time: ${elapsedTime} ms`)
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
