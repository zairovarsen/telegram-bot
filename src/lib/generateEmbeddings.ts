import { getRedisClient, getUserEmbeddingsMonthTokenCountKey } from "./redis";
import { MIN_CONTENT_LENGTH } from "@/utils/constants";
import { getDocuments } from "@/utils/getDocument";
import { createEmbedding } from "@/lib/openai";
import { backOff } from "exponential-backoff";
import getDocumentPdf from "@/utils/getDocumentPdf";
import { Document, Error } from './../types/index';

import { supabaseClient } from "./supabase";

// const queue = new PQueue({ concurrency: Infinity });

// export const generateEmbeddings = async (
//   url: string,
//   userId: number,
//   type?: "pdf" | "url"
// ) => {
//   let embeddingsTokenCount = 0;
//   let errors: Error[] = [];
//   let documents: Document[] = [];

//   const embeddingsData: {
//     user_id: number;
//     content: string;
//     token_count: number;
//     embedding: number[];
//     url: string;
//   }[] = [];

//   if (type === "pdf") {
//     try {
//       documents = await getDocumentPdf(url as string);
//     } catch (error) {
//       errors.push({
//         url,
//         message: `Unable to generate embeddings for pdf: ${error}`,
//       });
//     }
//   } else {
//     try {
//       documents = await getDocuments(url as string);
//     } catch (error) {
//       errors.push({
//         url,
//         message: `Unable to generate documents for url: ${error}`,
//       });
//     }
//   }

//   if (errors.length > 0) return errors;

//   if (documents.length > 200) {
//     errors.push({
//       url,
//       message: `Unable to generate embeddings for url: ${url} because it has more than 200 sections`,
//     });
//     return errors;
//   }

//   console.log(`Document length: ${documents.length}`)

//   for (const { url, body } of documents) {
//     const input = body.replace(/\n/g, " ");


//     // Ignore content short than MIN_CONTENT_LENGTH
//     if (input.length < MIN_CONTENT_LENGTH) {
//       continue;
//     }

//     try {
//       // Retry with exponential backoff in case of error. Typical cause is
//       // too_many_requests.
//       const embeddingResult = await queue.add(() => backOff(() => createEmbedding(input), {
//         startingDelay: 10000,
//         numOfAttempts: 10,
//       }), {throwOnTimeout: true});
      
//       embeddingsTokenCount += embeddingResult.usage?.total_tokens ?? 0;
//       console.log(`Embedding token count: ${embeddingsTokenCount}`);
//       console.log(`Embedding: ${embeddingResult.data[0].embedding}`)

//       // Store the emedding in Postgres db.
//       embeddingsData.push({
//         user_id: userId,
//         content: input,
//         token_count: embeddingResult.usage.total_tokens ?? 0,
//         embedding: embeddingResult.data[0].embedding,
//         url,
//       });
//     } catch (error) {
//       const snippet = input.slice(0, 20);
//       console.error(`Error ${error}`);
//       errors.push({
//         url,
//         message: `Unable to generate embeddings for section starting with '${snippet}...': ${error}`,
//       });
//     }
//   }

//   const { error } = await supabaseClient
//     .from("document")
//     .insert(embeddingsData);

//   if (error) {
//     console.error("Error storing embeddings in db: ", error);
//     for (const data of embeddingsData) {
//       await supabaseClient.from("document").insert([data]);
//     }
//   }

//   console.log("Tokens count: ", embeddingsTokenCount);

//   await getRedisClient().incrby(
//     getUserEmbeddingsMonthTokenCountKey(userId, new Date()),
//     embeddingsTokenCount
//   );

//   return errors;
// };
