import { createDocumentsBatch } from "./supabase";
import { Document } from "@/types";
import pdfParse from "pdf-parse";
import {
  DOC_SIZE,
  INSUFFICIENT_TOKENS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  MIN_CONTENT_LENGTH,
  UNABLE_TO_PROCESS_PDF_MESSAGE,
} from "@/utils/constants";
import GPT3Tokenizer from "gpt3-tokenizer";
import { redlock, getRedisClient, hget } from "@/lib/redis";
import { InsertDocuments } from "@/lib/supabase";
import { createEmbedding } from "@/lib/openai";
import { backOff } from "exponential-backoff";

export type PdfBody = {
  chatId: number;
  messageId: number;
  fileId: string;
  userId: number;
};

export type EmbeddingResult = {
  success: true;
  fileUrl?: string;
  tokenCount: number;
} | {
  success: false;
  errorMessage: string | string[];
};

type DocumentGenerationResult = {
  success: true;
  documents: Document[];
} | {
  success: false;
  errorMessage: string;
}

// TODO: Consider adding checksum to avoid duplicate processing, error detection, etc. Food for thought.

const updateUserTokenCountRedis = async (
  userId: number,
  tokenCount: number
): Promise<void> => {
  const userKey = `user:${userId}`;
  const redisMulti = getRedisClient().multi(); // Start a transaction
  redisMulti.hincrby(userKey, "tokens", -tokenCount);
  const res = await redisMulti.exec(); // Execute the transaction
};

/**
 * Generate documents from a PDF file
 *
 * @param {string} pdfPath - URL path to the PDF file
 * @param {number} totalTokens - Number of tokens available for embedding generation
 * @return {Promise<DocumentGenerationResult>} - DocumentGenerationResult
 */
const generateDocuments = async (
  pdfPath: string,
  totalTokens: number
): Promise<DocumentGenerationResult> => {
  try {
    const documents: Document[] = [];
    const tokenizer = new GPT3Tokenizer({ type: "gpt3" });

    const response = await fetch(pdfPath);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const data = await pdfParse(buffer);

    const lines = data.text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .join("");
    let start = 0;
    let remainingTokens = totalTokens;

    while (start < lines.length) {
      const end = start + DOC_SIZE;
      const chunk = lines.slice(start, end);

      if (chunk.length < MIN_CONTENT_LENGTH) {
        start = end;
        continue;
      }

      const { bpe } = tokenizer.encode(chunk);
      const tokensCount = bpe.length;
      remainingTokens -= tokensCount;

      if (remainingTokens < 0) {
        return {
          success: false,
          errorMessage: INSUFFICIENT_TOKENS_MESSAGE,
        };
      }

      documents.push({ url: pdfPath, body: chunk });
      start = end;
    }

    return {
      success: true,
      documents,
    };
  } catch (e) {
    return {
      success: false,
      errorMessage: UNABLE_TO_PROCESS_PDF_MESSAGE,
    };
  }
};

/**
 * Process a PDF file, extract the text, generate embeddings, save embeddings in vector database (supabase)
 *
 * @param {string} pdfPath - URL path to the PDF file
 * @param {number} totalTokens - Number of tokens available for embedding generation
 * @return {Promise<EmbeddingResult>} - EmbeddingResult
 */
export async function processPdf(
  pdfPath: string,
  userId: number
): Promise<EmbeddingResult> {
  const userLockResource = `locks:user:token:${userId}`;
  try {
    // Acquire a lock on the user resource
    // TODO: think of a good TTL value, 5 minutes for now
    const key = `user:${userId}`;
    let lock = await redlock.acquire([userLockResource], 5 * 60 * 1000);
    let embeddingsTokenCount = 0;

    const embeddingsData: InsertDocuments[] = [];
    const errorMessages: string[] = [];

    try {
      const totalTokens = parseInt((await hget(key, "tokens")) || "0");
    
      if (totalTokens <= 0) {
        return {
          success: false,
          errorMessage: INSUFFICIENT_TOKENS_MESSAGE,
        };
      }

      const documents = await generateDocuments(pdfPath, totalTokens);
      if (!documents.success) {
        return {
          success: false,
          errorMessage: documents.errorMessage,
        };
      }

      if (!documents.documents || documents.documents.length === 0) {
        return {
          success: false,
          errorMessage: UNABLE_TO_PROCESS_PDF_MESSAGE,
        };
      }

      for (const { url, body } of documents.documents) {
        const input = body.replace(/\n/g, " ");

        // Ignore content short than MIN_CONTENT_LENGTH
        if (input.length < MIN_CONTENT_LENGTH) {
          continue;
        }

        try {
          // Retry with exponential backoff in case of error. Typical cause is
          // too_many_requests.
          const embeddingResult = await backOff(
            () => createEmbedding({ input, model: "text-embedding-ada-002" }),
            {
              startingDelay: 10000,
              numOfAttempts: 10,
            }
          );

          console.log(`Embedding result: ${JSON.stringify(embeddingResult)}`);

          embeddingsTokenCount += embeddingResult?.usage?.total_tokens ?? 0;
          console.log(`Embedding token count: ${embeddingsTokenCount}`);
          console.log(`Embedding: ${embeddingResult?.data[0].embedding}`);

          // Store the emedding in Postgres db.
          embeddingsData.push({
            user_id: userId,
            content: input,
            token_count: embeddingResult?.usage.total_tokens ?? 0,
            embedding: embeddingResult?.data[0].embedding,
            url,
          });
        } catch (error) {
          const snippet = input.slice(0, 20);
          console.error(`Error ${error}`);
          errorMessages.push(
            `Unable to generate embeddings for section starting with '${snippet}...': ${error}`
          );
        }
      }

      if (embeddingsData.length === 0) {
        return {
          success: false,
          errorMessage: UNABLE_TO_PROCESS_PDF_MESSAGE,
        };
      }

      let newTokenCountTotal = totalTokens - embeddingsTokenCount;
      if (newTokenCountTotal < 0) {
        console.error(
          `There might be a bug in the code. Beucase the new token count is negative: ${newTokenCountTotal}, totalTokens: ${totalTokens}, embeddingsTokenCount: ${embeddingsTokenCount}`
        );
        newTokenCountTotal = 0;
      }

      // Save the embeddings in the database
      const createDocumentsResponseBatch = await createDocumentsBatch(
        embeddingsData
      );
      if (!createDocumentsResponseBatch) {
        console.error(`Unable to save embeddings in batch the database`);
        // Try one by one
        for (const embedding of embeddingsData) {
          const createDocumentsResponse = await createDocumentsBatch([
            embedding,
          ]);
          if (!createDocumentsResponse) {
            console.error(`Unable to save embedding in the database`);
            errorMessages.push(`Unable to save embedding in the database`);
            return {
              success: false,
              errorMessage: errorMessages,
            };
          }
        }
      }

      await updateUserTokenCountRedis(userId, newTokenCountTotal);

      // return the new token count
      return { success: true, tokenCount: newTokenCountTotal };
    } catch (err) {
      console.error(err);
      return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
    } finally {
      // Release the lock when we're done
      await lock.release();
    }
  } catch (err) {
    // Error acquiring lock
    console.error(err);
    return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
  }
}
