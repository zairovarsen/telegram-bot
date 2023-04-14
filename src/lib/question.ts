import { TelegramBot } from "@/types";
import { getRedisClient, hget, lock } from "@/lib/redis";
import {
  createCompletion,
  createCompletionStream,
  createEmbedding,
  createModeration,
  getPayload,
} from "@/lib/openai";
import {
  CONTEXT_TOKENS_CUTOFF,
  INSUFFICIENT_TOKENS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  MODERATION_ERROR_MESSAGE,
  UNANSWERED_QUESTION_MESSAGE,
  UNANSWERED_QUESTION_MESSAGE_PDF,
} from "@/utils/constants";
import { editMessageText, sendChatAction, sendMessage } from "@/lib/bot";
import {
  estimateEmbeddingTokens,
  estimateTotalCompletionTokens,
} from "@/utils/tokenizer";
import { matchDocuments, updateUserTokens } from "@/lib/supabase";
import { CreateEmbeddingResponse } from "openai";
import { backOff } from "exponential-backoff";

/**
 * Process general question using OpenAI completion API
 *
 * @param text
 * @param message
 * @param userId
 * @returns void
 */
export const processGeneralQuestion = async (
  text: string,
  message: TelegramBot.Message,
  userId: number
): Promise<void> => {
  const userKey = `user:${userId}`;
  const userLockResource = `locks:user:token:${userId}`;
  const {
    chat: { id: chatId },
    message_id: messageId,
  } = message;

  try {
    let unlock = await lock(userLockResource);

    try {
      const totalTokensRemaining = parseInt(
        (await hget(userKey, "tokens")) || "0"
      );
      console.log(`Total tokens remaining: ${totalTokensRemaining}`);

      const sanitizedQuestion = text.replace(/(\r\n|\n|\r)/gm, "");

      const moderationReponse = await createModeration({
        input: sanitizedQuestion,
      });
      console.log(
        `Moderation response: ${moderationReponse?.results?.[0]?.flagged}`
      );
      if (moderationReponse?.results?.[0]?.flagged) {
        console.error("Question is not allowed");
        await sendMessage(chatId, MODERATION_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const estimatedTokensForRequest =
        estimateTotalCompletionTokens(sanitizedQuestion);
      console.log(`Estimated tokens for request: ${estimatedTokensForRequest}`);

      if (totalTokensRemaining < estimatedTokensForRequest) {
        console.error("Insufficient tokens");
        await sendMessage(chatId, INSUFFICIENT_TOKENS_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      await sendChatAction(chatId, "typing");
      const body = getPayload(sanitizedQuestion, "gpt-3.5-turbo");
      const completion = await createCompletion(body);
      if (!completion) {
        console.error("Completion failed");
        await sendMessage(message.chat.id, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const tokensUsed = completion?.usage?.total_tokens || 0;
      const totalTokensRemainingAfterRequest =
        totalTokensRemaining - tokensUsed;
      console.log(
        `Tokens used total: ${tokensUsed}, prompt tokens: ${completion?.usage?.prompt_tokens}, completion tokens: ${completion?.usage?.completion_tokens}`
      );
      console.log(
        `Tokens remained after request : ${totalTokensRemainingAfterRequest}`
      );

      const updateDbTokens = await updateUserTokens(
        userId,
        totalTokensRemainingAfterRequest
      );

      if (!updateDbTokens) {
        console.error("Failed to update user tokens , supabase error");
        await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const redisMulti = getRedisClient().multi(); // Start a transaction
      redisMulti.hset(userKey, {
        tokens:
          totalTokensRemainingAfterRequest > 0
            ? totalTokensRemainingAfterRequest
            : 0,
      });
      await redisMulti.exec();

      const answer =
        completion?.choices[0]?.message?.content || UNANSWERED_QUESTION_MESSAGE;
      await sendMessage(chatId, answer, {
        reply_to_message_id: messageId,
      });
    } catch (err) {
      console.error(err);
      await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
        reply_to_message_id: messageId,
      });
    } finally {
      await unlock();
    }
  } catch (err) {
    // Release the lock
    console.error(err);
    await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
      reply_to_message_id: messageId,
    });
  }
};

/**
 * Process PDF question using OpenAI completion and embeddings API
 *
 * @param text
 * @param message
 * @param userId
 * @returns
 */
export const processPdfQuestion = async (
  text: string,
  message: TelegramBot.Message,
  userId: number
): Promise<void> => {
  const userKey = `user:${userId}`;
  const userLockResource = `locks:user:token:${userId}`;
  const {
    chat: { id: chatId }, message_id: messageId,
  } = message;

  try {
    let unlock = await lock(userLockResource);
    try {
      const totalTokensRemaining = parseInt(
        (await hget(userKey, "tokens")) || "0"
      );
      console.log(`Total tokens remaining: ${totalTokensRemaining}`);

      const sanitizedQuestion = text.replace(/(\r\n|\n|\r)/gm, "");
      console.log(`Sanitized question: ${sanitizedQuestion}`);

      const moderationReponse = await createModeration({
        input: sanitizedQuestion,
      });
      if (moderationReponse?.results?.[0]?.flagged) {
        console.error("Question is not allowed");
        await sendMessage(chatId, MODERATION_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const estimatedTokensForEmbeddingsRequest =
        estimateEmbeddingTokens(sanitizedQuestion);
      console.log(
        `Estimated tokens for embeddings request: ${estimatedTokensForEmbeddingsRequest}`
      );

      if (
        totalTokensRemaining <
        estimatedTokensForEmbeddingsRequest + CONTEXT_TOKENS_CUTOFF + 500
      ) {
        console.error("Insufficient tokens");
        sendMessage(chatId, INSUFFICIENT_TOKENS_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      await sendChatAction(chatId, "typing");

      let embeddingResult: CreateEmbeddingResponse | null = null;
      try {
        // Retry with exponential backoff in case of error. Typically, this is due to too_many_requests
        embeddingResult = await backOff(
          () =>
            createEmbedding({
              input: sanitizedQuestion,
              model: "text-embedding-ada-002",
            }),
          {
            startingDelay: 100000,
            numOfAttempts: 10,
          }
        );
      } catch (error) {
        console.error(`Embedding creation error: `, error);
      }

      const totalTokensUsedForEmbeddingsRequest =
        embeddingResult?.usage?.total_tokens || 0;
      const promptEmbedding = embeddingResult?.data?.[0]?.embedding;

      if (!promptEmbedding) {
        console.error("Embedding failed");
        sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const documents = await matchDocuments(promptEmbedding);

      if (!documents) {
        const remainingTokens =
          totalTokensRemaining - totalTokensUsedForEmbeddingsRequest;
        const updateDbTokens = await updateUserTokens(userId, remainingTokens);

        if (!updateDbTokens) {
          console.error("Failed to update user tokens , supabase error");
          sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          });
          return;
        }
        const redisMulti = getRedisClient().multi(); // Start a transaction
        redisMulti.hset(userKey, {
          tokens: remainingTokens > 0 ? remainingTokens : 0,
        });
        await redisMulti.exec();
        console.error("Supabase query failed for mathcing documents");
        sendMessage(chatId, UNANSWERED_QUESTION_MESSAGE_PDF, {
          reply_to_message_id: messageId,
        });
        return;
      }

      let tokenCount = 0;
      let contextText = "";

      // Concat matched documents
      for (let i = 0; i < documents.length; i++) {
        const document = documents[i];
        const content = document.content;
        const url = document.url;
        tokenCount += document.token_count;

        // Limit context to max 1500 tokens (configurable)
        if (tokenCount > CONTEXT_TOKENS_CUTOFF) {
          break;
        }

        contextText += `${content.trim()}\nSOURCE: ${url}\n---\n`;
      }

      const prompt = `\
          You are a helpful assistant. When given CONTEXT you answer questions using only that information,
          and you always format your output in markdown. You include code snippets if relevant. If you are unsure and the answer
          is not explicitly written in the CONTEXT provided, you say
          "Sorry, I don't know how to help with that." If the CONTEXT includes
          source URLs include them under a SOURCES heading at the end of your response. Always include all of the relevant source urls
          from the CONTEXT, but never list a URL more than once (ignore trailing forward slashes when comparing for uniqueness). Never include URLs that are not in the CONTEXT sections. Never make up URLs

      CONTEXT:
      ${contextText}

      QUESTION: """
      ${sanitizedQuestion}
      """`;

      const payload = getPayload(prompt, "gpt-3.5-turbo");

      const completion = await createCompletion(payload);

      if (!completion) {
        console.error(`Completion error: `, completion);
        sendMessage(chatId,INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const totalTokensUsedForCompletionRequest =
        completion?.usage?.total_tokens || 0;
      const totalTokensUsed =
        totalTokensUsedForEmbeddingsRequest +
        totalTokensUsedForCompletionRequest;
      const remainingTokens = totalTokensRemaining - totalTokensUsed;

      const updateDbTokens = await updateUserTokens(userId, remainingTokens);

      if (!updateDbTokens) {
        console.error("Failed to update user tokens , supabase error");
        sendMessage(chatId,INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const redisMulti = getRedisClient().multi(); // Start a transaction
      redisMulti.hset(userKey, {
        tokens: remainingTokens > 0 ? remainingTokens : 0,
      });
      await redisMulti.exec();

      console.log(`Completion: `, JSON.stringify(completion, null, 2));

      // get a json object from the response
      sendMessage(chatId,completion.choices[0].message?.content as string, {
        reply_to_message_id: messageId,
      });
    } catch (err) {
      console.error(err);
      sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
        reply_to_message_id: messageId,
      });
    } finally {
      // Release the lock
      await unlock();
    }
  } catch (err) {
    console.error(err);
    sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
      reply_to_message_id: messageId,
    });
  }
};
