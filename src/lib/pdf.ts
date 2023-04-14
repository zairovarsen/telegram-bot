import { Embedding } from "@/types";
import {
  DOC_SIZE,
  DUPLICATE_FILE_UPLOAD_MESSAGE,
  INSUFFICIENT_TOKENS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  MIN_CONTENT_LENGTH,
  UNABLE_TO_PROCESS_PDF_MESSAGE,
} from "@/utils/constants";
import { getRedisClient, hget, lock } from "@/lib/redis";
import { InsertDocuments, checkUserFileHashExist, createDocumentsBatch, updateUserTokens, uploadFileToSupabaseStorage } from "@/lib/supabase";
import { createEmbedding } from "@/lib/openai";
import { backOff } from "exponential-backoff";
import { tokenizer } from "@/utils/tokenizer";
import { sha256 } from "hash-wasm";
import pdfParse from "pdf-parse";

import { performance } from 'perf_hooks';


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
  documents: Embedding[];
} | {
  success: false;
  errorMessage: string;
}

// TODO: Consider adding checksum to avoid duplicate processing, error detection, etc. Food for thought.
// TODO: Consider using Supabase Storage for file storage

/**
 * Upload a User Token Count to Redis
 * 
 * @param userId 
 * @param tokenCount 
 */
const updateUserTokenCountRedis = async (
  userId: number,
  tokenCount: number
): Promise<void> => {
  const userKey = `user:${userId}`;
  const redisMulti = getRedisClient().multi(); // Start a transaction
  redisMulti.hset(userKey, {
    tokens: tokenCount > 0 ? tokenCount : 0,
  });
  await redisMulti.exec(); // Execute the transaction
};


/**
 * Calculate the SHA256 hash of a file for avoiding file deduplication
 * 
 * @param fileContent 
 * @returns 
 */
const calculateSha256 = async (fileContent: Buffer): Promise<string> => {
  return await sha256(fileContent); 
}

/**
 * Generate documents from a PDF file
 *
 * @param {string} pdfPath - URL path to the PDF file
 * @param {number} totalTokens - Number of tokens available for embedding generation
 * @return {Promise<DocumentGenerationResult>} - DocumentGenerationResult
 */
const generateDocuments = async (
  userId: number,
  pdfPath: string,
  totalTokens: number
): Promise<DocumentGenerationResult> => {
  try {
    const documents: Embedding[] = [];

    const response = await fetch(pdfPath);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
 
    const sha256 = await calculateSha256(buffer);

    const fileExist = await checkUserFileHashExist(userId, sha256);

    if (fileExist) {
      return {
        success: false,
        errorMessage: DUPLICATE_FILE_UPLOAD_MESSAGE,
      }
    }

    const data = await pdfParse(buffer);

    console.log(`Number of pages: ${data.numpages}`);
    
    // const fileUploadUrl = await uploadFileToSupabaseStorage(buffer);    

    // if (!fileUploadUrl) {
    //   return {
    //     success: false,
    //     errorMessage: UNABLE_TO_PROCESS_PDF_MESSAGE,
    //   }
    // };

    // console.log(`File upload URL: ${fileUploadUrl}`);

    const lines = data.text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .join("");
    let start = 0;
    let remainingTokens = totalTokens;
    console.log(`Number of lines: ${lines.length}`)
     
    while (start < lines.length) {

      const end = start + DOC_SIZE;
      const chunk = lines.slice(start, end).replace(/\n/g, " ");


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

      documents.push({ url: pdfPath, body: chunk, hash: sha256 });
      start = end;
    }

    console.log(`User has ${remainingTokens} tokens left. According to the tokenizer, the user has used ${totalTokens - remainingTokens} tokens.`)

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
  console.log('processing file')
  const userLockResource = `locks:user:token:${userId}`;
  const key = `user:${userId}`;
  try {
    // Acquire a lock on the user resource
    // TODO: think of a good TTL value, 5 minutes for now
    let unlock = await lock(userLockResource)
    let embeddingsTokenCount = 0;

    const embeddingsData: InsertDocuments[] = [];
    const errorMessages: string[] = [];

    try {
      const totalTokens = parseInt((await hget(key, "tokens")) || "0");
      console.log(`Total tokens: ${totalTokens}`);
    
      if (totalTokens <= 0) {
        return {
          success: false,
          errorMessage: INSUFFICIENT_TOKENS_MESSAGE,
        };
      }

              const startTime = performance.now();

      // Generates the document in chunks of 1500 , also checks if the total tokens are sufficient to generate embeddings
      const documents = await generateDocuments(userId,pdfPath, totalTokens);
      if (!documents.success) {
        return {
          success: false,
          errorMessage: documents.errorMessage,
        };
      }

         const endTime = performance.now();
        const elapsedTime = endTime - startTime;
        console.log(`Elapsed time: to generateDocuments ${elapsedTime} ms`);


      if (!documents.documents || documents.documents.length === 0) {
        return {
          success: false,
          errorMessage: UNABLE_TO_PROCESS_PDF_MESSAGE,
        };
      }

                    const startTime2 = performance.now();
      for (const { url, body, hash } of documents.documents) {
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

          embeddingsTokenCount += embeddingResult?.usage?.total_tokens ?? 0;
          console.log(`Embedding token count: ${embeddingsTokenCount}`);

          // Store the emedding in Supabase db.
          embeddingsData.push({
            user_id: userId,
            content: input,
            token_count: embeddingResult?.usage.total_tokens ?? 0,
            embedding: embeddingResult?.data[0].embedding as any,
            url,
            hash,
          });
        } catch (error) {
          const snippet = input.slice(0, 20);
          console.error(`Error ${error}`);
          errorMessages.push(
            `Unable to generate embeddings for section starting with '${snippet}...': ${error}`
          );
        }
      }
      const endTime2 = performance.now();
      const elapsedTime2 = endTime2 - startTime2;
      console.log(`Elapsed time: to generate Embedding from Documents ${elapsedTime2} ms`);

      if (embeddingsData.length === 0) {
        return {
          success: false,
          errorMessage: UNABLE_TO_PROCESS_PDF_MESSAGE,
        };
      }

      let newTokenCountTotal = totalTokens - embeddingsTokenCount;
      console.log(`New token count: ${newTokenCountTotal}. According to the ChatGPT API, the user has used ${embeddingsTokenCount} tokens.`)
      if (newTokenCountTotal < 0) {
        console.error(
          `There might be a bug in the code. Beucase the new token count is negative: ${newTokenCountTotal}, totalTokens: ${totalTokens}, embeddingsTokenCount: ${embeddingsTokenCount}`
        );
        newTokenCountTotal = 0;
      }

                          const startTime3 = performance.now();
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

      // Update the user's token count in Supabase
      const updateUserTokensDB = await updateUserTokens(userId, newTokenCountTotal);
      if (!updateUserTokensDB) {
        console.error(`Unable to update user's token count in the database`);
        return {
          success: false,
          errorMessage: errorMessages,
        };
      }

      await updateUserTokenCountRedis(userId, newTokenCountTotal);

      const endTime3 = performance.now();
      const elapsedTime3 = endTime3 - startTime3;
      console.log(`Elapsed time: to createdocument in db , update token count in db and update redis, ${elapsedTime3} ms`);

      // return the new token count
      return { success: true, tokenCount: newTokenCountTotal };
    } catch (err) {
      console.error(err);
      return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
    } finally {
      // Release the lock when we're done
      await unlock();
    }
  } catch (err) {
    // Error acquiring lock
    console.error(err);
    return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
  }
}
