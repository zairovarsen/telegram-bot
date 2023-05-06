
import { OpenAI } from "langchain/llms/openai";

const llm = new OpenAI({temperature: 0, apiKey: process.env.OPENAI_API_KEY})

export {llm};