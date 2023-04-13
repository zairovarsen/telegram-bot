import { Configuration, CreateChatCompletionRequest, CreateChatCompletionResponse, CreateEmbeddingRequest, CreateEmbeddingResponse, CreateModerationRequest, CreateModerationResponse, OpenAIApi, CreateTranslationResponse } from "openai";
import { MAX_TOKENS_COMPLETION } from "@/utils/constants";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

export type OpenAIModel = 'gpt-4' | 'gpt-3.5-turbo' | 'text-davinci-003';

/**
 * Create a moderation request
 * 
 * @param input The input to be moderated
 * @returns The moderation response
 */
export const createModeration = async ({input}: CreateModerationRequest): Promise<CreateModerationResponse | null> => {
  try {
    const moderation = await openai.createModeration({input})
    return moderation.data;
  } catch (err) {
    return null;
  }
};

/**
 * Create an embedding request
 * 
 * @param input The input to be embedded
 * @param model The model to use
 * @returns The embedding response
 */
export const createEmbedding = async (
  { input, model }: CreateEmbeddingRequest
): Promise<CreateEmbeddingResponse | null> => {

  try { 
    const embedding = await openai.createEmbedding({input, model})
    return embedding.data;
  } catch (err) {
    console.error(`OpenAI embedding error: ${err}`)
    return null;
  }
};

export const createCompletion = async (
  payload: CreateChatCompletionRequest
): Promise<CreateChatCompletionResponse | null> => {
  try {
    console.log('Calling completion if not vercel sucks')
    const completion = await openai.createChatCompletion(payload);
    return completion.data;
  } catch (err) {
    console.error(`OpenAI completion error: ${err}`)
    return null;
  }
};


/**
 * Generate a completion stream , problem is editText in telegram gives too many requests error, think of alternative way to do this
 * @param payload The completion payload
 * @param onChunk The callback to call when a chunk is received
 * @returns The completion stream response
 */
export const generateCompletion = async (
  payload: CreateChatCompletionRequest,
  onChunk: (chunk: string) => void
): Promise<CreateChatCompletionResponse | null> => {
  return new Promise(async (resolve, reject) => {
    try {
      const res = (await openai.createChatCompletion(payload, { responseType: 'stream' })) as any;

      res.data.on('data', (data:Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          const message = line.replace(/^data: /, '');
          if (message === '[DONE]') {
            resolve(null);
            return; // Stream finished
          }
          try {
            const parsed = JSON.parse(message);
            const chunk = parsed.choices[0].delta?.content || "";
            onChunk(chunk);
          } catch (error) {
            console.error('Could not JSON parse stream message', message, error);
          }
        }
      });
    } catch (error: any) {
      if (error.response?.status) {
        console.error(error.response.status, error.message);
        error.response.data.on('data', (data:any) => {
          const message = data.toString();
          try {
            const parsed = JSON.parse(message);
            console.error('An error occurred during OpenAI request: ', parsed);
          } catch (error) {
            console.error('An error occurred during OpenAI request: ', message);
          }
        });
      } else {
        console.error('An error occurred during OpenAI request', error);
      }
      reject(error);
    }
  });
}

/**
 * Get the payload for a completion request
 * 
 * @param prompt The prompt to use
 * @param model The model to use
 * @returns The completion payload
 */
export const getPayload = (prompt: string, model: OpenAIModel, stream?: boolean): CreateChatCompletionRequest => {
  const payload = {
    model,
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: MAX_TOKENS_COMPLETION,
    stream: stream || false,
    n: 1,
  };

  return {
    ...payload,
    messages: [{ role: "user", content: prompt }],
  }
};

export const createTranslation = async (
  file: any,
): Promise<CreateTranslationResponse | null> => {
  try {
    const translation = await openai.createTranslation(file, "whisper-1");
    return translation.data;
  } catch (err) {
    console.error(`OpenAI translation error: ${err}`)
    return null;
  }
}