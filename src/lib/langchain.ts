import { MAX_TOKENS_COMPLETION } from '@/utils/constants';
import { OpenAIModerationChain } from 'langchain/chains';
import { OpenAI } from 'langchain';



const llm = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxTokens: MAX_TOKENS_COMPLETION, maxRetries: 10});
const moderation = new OpenAIModerationChain();


export { llm, moderation}
