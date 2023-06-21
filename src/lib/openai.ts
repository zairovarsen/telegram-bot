import {
  Configuration,
  CreateChatCompletionRequest,
  CreateChatCompletionResponse,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  CreateModerationRequest,
  CreateModerationResponse,
  OpenAIApi,
  CreateTranslationResponse,
} from 'openai'
import { MAX_TOKENS_COMPLETION } from '@/utils/constants'
import {
  ParsedEvent,
  ReconnectInterval,
  createParser,
} from 'eventsource-parser'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
})

const openai = new OpenAIApi(configuration)

export type OpenAIModel =
  | 'gpt-4'
  | 'gpt-3.5-turbo'
  | 'text-davinci-003'
  | 'gpt-3.5-turbo-16k'

/**
 * Create a moderation request
 *
 * @param input The input to be moderated
 * @returns The moderation response
 */
export const createModeration = async ({
  input,
}: CreateModerationRequest): Promise<CreateModerationResponse | null> => {
  try {
    return await fetch('https://api.openai.com/v1/moderations', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      },
      method: 'POST',
      body: JSON.stringify({ input }),
    }).then(r => r.json())
  } catch (err) {
    console.error(`OpenAI moderation error: ${err}`)
    return null
  }
}

/**
 * Create an embedding request
 *
 * @param input The input to be embedded
 * @param model The model to use
 * @returns The embedding response
 */
export const createEmbedding = async ({
  input,
  model,
}: CreateEmbeddingRequest): Promise<CreateEmbeddingResponse | null> => {
  try {
    return await fetch('https://api.openai.com/v1/embeddings', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      },
      method: 'POST',
      body: JSON.stringify({
        model: model,
        input: input,
      }),
    }).then(r => r.json())
  } catch (err) {
    console.error(`OpenAI embedding error: ${err}`)
    return null
  }
}

export const createCompletion = async (
  payload: CreateChatCompletionRequest,
): Promise<CreateChatCompletionResponse | null> => {
  try {
    return await fetch('https://api.openai.com/v1/chat/completions', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      },
      method: 'POST',
      body: JSON.stringify({
        ...payload,
      }),
    }).then(r => r.json())
  } catch (err) {
    console.error(`OpenAI completion error: ${err}`)
    return null
  }
}

/**
 * Generate a completion stream , problem is editText in telegram gives too many requests error, think of alternative way to do this
 * @param payload The completion payload
 * @param onChunk The callback to call when a chunk is received
 * @returns The completion stream response
 */
export const createCompletionStream = async (
  payload: CreateChatCompletionRequest,
  onChunk: (chunk: string) => void,
): Promise<ReadableStream | null> => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  let counter = 0

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    method: 'POST',
    body: JSON.stringify(payload),
  })

  const stream = new ReadableStream({
    async start(controller) {
      // callback
      function onParse(event: ParsedEvent | ReconnectInterval) {
        if (event.type === 'event') {
          const data = event.data
          // https://beta.openai.com/docs/api-reference/completions/create#completions/create-stream
          if (data === '[DONE]') {
            controller.close()
            return
          }
          try {
            const json = JSON.parse(data)
            const text = json.choices[0].delta?.content || ''
            if (counter < 2 && (text.match(/\n/) || []).length) {
              // this is a prefix character (i.e., "\n\n"), do nothing
              return
            }
            onChunk(text)
            const queue = encoder.encode(text)
            controller.enqueue(queue)
            counter++
          } catch (e) {
            // maybe parse error
            controller.error(e)
          }
        }
      }

      // stream response (SSE) from OpenAI may be fragmented into multiple chunks
      // this ensures we properly read chunks and invoke an event for each SSE event stream
      const parser = createParser(onParse)
      // https://web.dev/streams/#asynchronous-iteration
      for await (const chunk of res.body as any) {
        parser.feed(decoder.decode(chunk))
      }
    },
  })

  return stream
}

/**
 * Get the payload for a completion request
 *
 * @param prompt The prompt to use
 * @param model The model to use
 * @returns The completion payload
 */
export const getPayload = (
  prompt: string,
  model: OpenAIModel,
  stream?: boolean,
  messagesCustom?: CreateChatCompletionRequest['messages'],
): CreateChatCompletionRequest => {
  const payload = {
    model,
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: MAX_TOKENS_COMPLETION,
    stream: stream || false,
    n: 1,
  }

  if (messagesCustom) {
    return {
      ...payload,
      messages: messagesCustom,
    }
  }

  return {
    ...payload,
    messages: [{ role: 'user', content: prompt }],
  }
}

export const createTranslation = async (
  file: any,
): Promise<CreateTranslationResponse | null> => {
  try {
    const translation = await openai.createTranslation(file, 'whisper-1')
    return translation.data
  } catch (err) {
    console.error(`OpenAI translation error: ${err}`)
    return null
  }
}
