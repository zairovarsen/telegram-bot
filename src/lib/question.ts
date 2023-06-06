import { TelegramBot } from '@/types'
import { hget, lock } from '@/lib/redis'
import { createEmbedding } from '@/lib/openai'
import {
  CONTEXT_TOKENS_CUTOFF,
  INTERNAL_SERVER_ERROR_MESSAGE,
  MAX_TOKENS_COMPLETION,
  UNANSWERED_QUESTION_MESSAGE,
} from '@/utils/constants'
import { sendChatAction, sendMessage } from '@/lib/bot'
import { matchDocuments } from '@/lib/supabase'
import { CreateEmbeddingResponse } from 'openai'
import { backOff } from 'exponential-backoff'
import {
  handleError,
  handleInsufficientTokens,
  updateUserTokensInRedisAndDb,
} from '@/utils/handlers'
import { llm, moderation } from './langchain'

// Function to get user tokens
const getUserTokens = async (userKey: string) => {
  return parseInt((await hget(userKey, 'tokens')) || '0');
};

// Function to check content moderation
const checkContent = async (content: string) => {
  await moderation.call({ input: content, throwError: true });
};

// Function to get estimated tokens
const getEstimatedTokens = async (input: string) => {
  return await llm.getNumTokens(input);
};

// Function to generate answer
const generateAnswer = async (input: string) => {
  return await llm.generate([input]);
};

const sanitizeInput = (input: string): string => input.replace(/(\r\n|\n|\r)/gm, '');


/* Open AI Completion */
export const processGeneralQuestion = async (
  text: string,
  message: TelegramBot.Message,
  userId: number,
  isNotTyping?: boolean,
): Promise<string | undefined> => {
  const userKey = `user:${userId}`
  const userLockResource = `locks:user:token:${userId}`
  const {
    chat: { id: chatId },
    message_id: messageId,
  } = message

  try {
    let unlock = await lock(userLockResource)

    try {
      const totalTokensRemaining = await getUserTokens(userKey);
      const sanitizedQuestion = sanitizeInput(text);

      await checkContent(sanitizedQuestion);
      
      const estimatedTokensForRequest =  await getEstimatedTokens(sanitizedQuestion);

      await handleInsufficientTokens(totalTokensRemaining, estimatedTokensForRequest);

      if (!isNotTyping) {
        await sendChatAction(chatId, 'typing')
      }

      const completion = await generateAnswer(sanitizedQuestion);

      await updateUserTokensInRedisAndDb(
        userId,
        totalTokensRemaining,
        completion?.llmOutput?.tokenUsage.totalTokens || 0,
      )

      const answer =
        completion?.generations[0][0].text || UNANSWERED_QUESTION_MESSAGE
      return answer
    } catch (err) {
      console.log(err);
      await handleError(chatId, messageId, err)
    } finally {
      await unlock()
    }
  } catch (err) {
    await handleError(chatId, messageId, err)
  }
}

/* Process PDF question using OpenAI completion and embeddings API */
export const processPdfQuestion = async (
  text: string,
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
    let unlock = await lock(userLockResource)
    try {
      const totalTokensRemaining = await getUserTokens(userKey);
      const sanitizedQuestion = sanitizeInput(text);

      await checkContent(sanitizedQuestion);
      await sendChatAction(chatId, 'typing')

      let embeddingResult: CreateEmbeddingResponse | null = null
      try {
        // Retry with exponential backoff in case of error. Typically, this is due to too_many_requests
        embeddingResult = await backOff(
          () =>
            createEmbedding({
              input: sanitizedQuestion,
              model: 'text-embedding-ada-002',
            }),
          {
            startingDelay: 100000,
            numOfAttempts: 10,
          },
        )
      } catch (error) {
        console.error(`Embedding creation error: `, error)
      }

      const totalTokensUsedForEmbeddingsRequest =
        embeddingResult?.usage?.total_tokens || 0
      const promptEmbedding = embeddingResult?.data?.[0]?.embedding

      if (!promptEmbedding) {
        throw new Error(INTERNAL_SERVER_ERROR_MESSAGE)
      }

      const documents = await matchDocuments(promptEmbedding)

      if (!documents) {
        throw new Error(INTERNAL_SERVER_ERROR_MESSAGE)
      }

      let tokenCount = 0
      let contextText = ''

      // Concat matched documents
      for (let i = 0; i < documents.length; i++) {
        const document = documents[i]
        const content = document.content
        const url = document.url
        tokenCount += document.token_count

        // Limit context to max 1500 tokens (configurable)
        if (tokenCount > CONTEXT_TOKENS_CUTOFF) {
          break
        }

        contextText += `${content.trim()}\nSOURCE: ${url}\n---\n`
      }

      const prompt = `\
          You are a helpful assistant. When given CONTEXT you answer questions using only that information,
          and you always format your output in markdown. You include code snippets if relevant. If you are unsure and the answer
          is not explicitly written in the CONTEXT provided, you say
          "Sorry, I don't know how to help with that." If the CONTEXT includes
          source URLs include them under a SOURCES heading at the end of your response. Always include all of the relevant source urls
          from the CONTEXT, but never list a URL more than once (ignore trailing forward slashes when comparing for uniqueness). Never include URLs that are not in the CONTEXT sections. Never make up URLs

          CONTEXT:
          ${contextText}

          QUESTION: """
          ${sanitizedQuestion}
      """
      `

      const completion = await llm.generate([prompt]);

      const totalTokensUsed =
        totalTokensUsedForEmbeddingsRequest +
        completion?.llmOutput?.tokenUsage.totalTokens || 0
      await updateUserTokensInRedisAndDb(
        userId,
        totalTokensRemaining,
        totalTokensUsed > totalTokensRemaining ? 0 : totalTokensUsed,
      )

      console.log(`Completion `, JSON.stringify(completion, null, 2))

      // get a json object from the response
      await sendMessage(
        chatId,
        completion?.generations[0][0].text || UNANSWERED_QUESTION_MESSAGE,
        {
          reply_to_message_id: messageId,
        },
      )
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
