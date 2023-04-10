import { Configuration, CreateChatCompletionRequest, CreateChatCompletionResponse, CreateEmbeddingRequest, CreateEmbeddingResponse, CreateModerationRequest, CreateModerationResponse, OpenAIApi } from "openai";


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
  { input, model='text-embedding-ada-002' }: CreateEmbeddingRequest
): Promise<CreateEmbeddingResponse | null> => {

  try { 
    const embedding = await openai.createEmbedding({input, model})
    return embedding.data;
  } catch (err) {
    console.error(`OpenAI embedding error: ${err}`)
    return null;
  }
};

/**
 * 
 * @param payload The completion payload
 * @returns The completion response
 */
export const createCompletion = async (
  payload: CreateChatCompletionRequest
): Promise<CreateChatCompletionResponse | null> => {
  try {
    const completion = await openai.createCompletion(payload);
    return completion.data;
  } catch(err) {
    console.error(`OpenAI completion error: ${err}`);
    return null;
  }
}

/**
 * Get the payload for a completion request
 * 
 * @param prompt The prompt to use
 * @param model The model to use
 * @returns The completion payload
 */
export const getPayload = (prompt: string, model: OpenAIModel): CreateChatCompletionRequest => {
  const payload = {
    model,
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 500,
    stream: false,
    n: 1,
  };

  return {
    ...payload,
    messages: [{ role: "user", content: prompt }],
  }
};



