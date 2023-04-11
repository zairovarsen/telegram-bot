import GPT3Tokenizer from "gpt3-tokenizer";
import { MAX_TOKENS_COMPLETION } from "./constants";

export const tokenizer = new GPT3Tokenizer({ type: "gpt3" });

/*
* Estimate the total number of tokens used in a completion request (heuristic subject to change). 
* 
* @param prompt The prompt to estimate
* @param maxTokens The maximum number of tokens allowed
* @returns The estimated number of tokens used
*/
export const estimateTotalCompletionTokens = (prompt: string): number => {
    const promptTokens = tokenizer.encode(prompt).bpe.length + 10;
    const estimateResponseTokens = promptTokens + MAX_TOKENS_COMPLETION;

    return Math.round(estimateResponseTokens)
}


export const estimateEmbeddingTokens = (prompt: string): number => {
    const promptTokens = tokenizer.encode(prompt).bpe.length;
    return promptTokens;
}