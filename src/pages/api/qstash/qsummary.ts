// // Embeddings generation endpoint for QStash
import { verifySignature } from '@upstash/qstash/nextjs'
import { NextApiRequest, NextApiResponse } from 'next'
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/utils/constants'
import { set } from '@/lib/redis'
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from 'langchain/prompts'
import { chat } from '@/lib/langchain'

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body

  try {
    const { userId, previousQuestion, question } = body as {
      previousQuestion: string
      userId: number
      question: string
    }

    const combinedQuestion = `${previousQuestion} ${question}`

    const prompt = ChatPromptTemplate.fromPromptMessages([
      SystemMessagePromptTemplate.fromTemplate(
        'Summarize the following text, do not exceed more than 100 words. Make sure to include  Return the summary as a string. Do not show you are summarizing.',
      ),
      HumanMessagePromptTemplate.fromTemplate('{question}'),
    ])

    const completion = await chat.generatePrompt([
      await prompt.formatPromptValue({
        question: combinedQuestion,
      }),
    ])

    await set(
      `user:${userId}:last_question`,
      completion?.generations[0][0].text || '',
    )

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
