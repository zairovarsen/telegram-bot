import { MAX_TOKENS_COMPLETION } from '@/utils/constants';
import { OpenAIModerationChain } from 'langchain/chains';
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import { ChatOpenAI } from "langchain/chat_models/openai";
import {
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "langchain/prompts";
import { OpenAI } from 'langchain';



const llm = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxTokens: MAX_TOKENS_COMPLETION, maxRetries: 10});
const moderation = new OpenAIModerationChain();

const chat = new ChatOpenAI({ temperature: 0, apiKey: process.env.OPENAI_API_KEY, maxTokens: MAX_TOKENS_COMPLETION, maxRetries: 10});

const chatPrompt = ChatPromptTemplate.fromPromptMessages([
  SystemMessagePromptTemplate.fromTemplate(
    "You are an intelligent AI who can answer any question and also maintains the list of previous user questions {history}, which you may or may not use depending on the context of the question. Please answer the following question: {input}"
  ),
  HumanMessagePromptTemplate.fromTemplate("{input}"),
]);

const chain = new ConversationChain({
    llm: chat,
    memory:  new BufferMemory({ returnMessages: true, memoryKey: "history" }),
    prompt: chatPrompt,
});

export { llm, chat, moderation, chain }
