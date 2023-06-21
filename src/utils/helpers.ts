import { llm, moderation } from '@/lib/langchain'
import { hget } from '@/lib/redis'

export const getUserTokens = async (userKey: string) => {
  return parseInt((await hget(userKey, 'tokens')) || '0')
}

export const checkContentForModeration = async (content: string) => {
  await moderation.call({ input: content, throwError: true })
}

export const getEstimatedTokens = async (input: string) => {
  return await llm.getNumTokens(input)
}

export const generateAnswer = async (input: string) => {
  return await llm.generate([input])
}

export const sanitizeInput = (input: string): string =>
  input.replace(/(\r\n|\n|\r)/gm, '')
