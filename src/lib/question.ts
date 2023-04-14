import { TelegramBot } from "@/types";
import { getRedisClient, hget, lock } from "@/lib/redis";
import { createCompletion, createCompletionStream, createModeration, getPayload } from "@/lib/openai";
import { INSUFFICIENT_TOKENS_MESSAGE, INTERNAL_SERVER_ERROR_MESSAGE, MODERATION_ERROR_MESSAGE, UNANSWERED_QUESTION_MESSAGE } from "@/utils/constants";
import { editMessageText, sendChatAction, sendMessage } from "@/lib/bot";
import { estimateTotalCompletionTokens } from "@/utils/tokenizer";
import { updateUserTokens } from "@/lib/supabase";

/**
 * Process general question using OpenAI completion API
 * 
 * @param text 
 * @param message 
 * @param userId 
 * @returns void
 */
export const processGeneralQuestion = async (text: string, message: TelegramBot.Message, userId: number): Promise<void> => {

    const userKey = `user:${userId}`;
      const userLockResource = `locks:user:token:${userId}`;
      try {
        let unlock = await lock(userLockResource);

        try {
          const totalTokensRemaining = parseInt(
            (await hget(userKey, "tokens")) || "0"
          );
          console.log(`Total tokens remaining: ${totalTokensRemaining}`)

          const sanitizedQuestion = text.replace(/(\r\n|\n|\r)/gm, "");

          const moderationReponse = await createModeration({input: sanitizedQuestion});
          console.log(`Moderation response: ${moderationReponse?.results?.[0]?.flagged}`)
          if (moderationReponse?.results?.[0]?.flagged) {
            console.error("Question is not allowed");
            await sendMessage(message.chat.id, MODERATION_ERROR_MESSAGE, {
                reply_to_message_id: message.reply_to_message?.message_id
            }) 
            return;
          }

          const estimatedTokensForRequest =
            estimateTotalCompletionTokens(sanitizedQuestion);
          console.log(
            `Estimated tokens for request: ${estimatedTokensForRequest}`
          );

          if (totalTokensRemaining < estimatedTokensForRequest) {
            console.error("Insufficient tokens");
            await sendMessage(message.chat.id, INSUFFICIENT_TOKENS_MESSAGE, {
                reply_to_message_id: message.reply_to_message?.message_id
            })
            return;
          }

          await sendChatAction(message.chat.id, "typing");
          const body = getPayload(sanitizedQuestion, "gpt-3.5-turbo");
          const completion = await createCompletion(body);
          if (!completion) {
            console.error("Completion failed");
            await sendMessage(message.chat.id, INTERNAL_SERVER_ERROR_MESSAGE, {
                reply_to_message_id: message.reply_to_message?.message_id
            })
            return;  
          }
          const tokensUsed = completion?.usage?.total_tokens || 0;
          const totalTokensRemainingAfterRequest =
            totalTokensRemaining - tokensUsed;
          console.log(`Tokens used total: ${tokensUsed}, prompt tokens: ${completion?.usage?.prompt_tokens}, completion tokens: ${completion?.usage?.completion_tokens}`);
          console.log(`Tokens remained after request : ${totalTokensRemainingAfterRequest}`)

          const updateDbTokens = await updateUserTokens(userId, totalTokensRemainingAfterRequest);

          if (!updateDbTokens) {
            console.error("Failed to update user tokens , supabase error");
            await sendMessage(message.chat.id, INTERNAL_SERVER_ERROR_MESSAGE, {
                reply_to_message_id: message.reply_to_message?.message_id
            })
            return;
          }

          const redisMulti = getRedisClient().multi(); // Start a transaction
          redisMulti.hset(userKey, {
            tokens: totalTokensRemainingAfterRequest > 0 ? totalTokensRemainingAfterRequest : 0,
          });
          await redisMulti.exec();

          const answer =
            completion?.choices[0]?.message?.content ||
            UNANSWERED_QUESTION_MESSAGE;
            await sendMessage(message.chat.id, answer, {
                reply_to_message_id: message.reply_to_message?.message_id
            })

        } catch (err) {
          console.error(err);
            await sendMessage(message.chat.id, INTERNAL_SERVER_ERROR_MESSAGE, {
                reply_to_message_id: message.reply_to_message?.message_id
            })
        } finally {
          await unlock()
        }
      } catch (err) {
        // Release the lock
        console.error(err);
        await sendMessage(message.chat.id, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: message.reply_to_message?.message_id
        })
      }
}