import { GENERATED_MEME_MESSAGE, MEME_OPTIONS } from "./../utils/constants";
import { TelegramBot } from "@/types";
import { getRedisClient, hget, lock } from "./redis";
import { createCompletion, createModeration, getPayload } from "./openai";
import { sendDocument, sendMessage } from "./bot";
import {
  CONTEXT_TOKENS_CUTOFF,
  INSUFFICIENT_TOKENS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  MODERATION_ERROR_MESSAGE,
} from "@/utils/constants";
import { estimateEmbeddingTokens } from "@/utils/tokenizer";
import { updateUserTokens } from "./supabase";

export type MemeType = (typeof MEME_OPTIONS)[number]["name"];

/**
 * Process PDF question using OpenAI completion and embeddings API
 *
 * @param text
 * @param message
 * @param userId
 * @returns
 */
export const processMemeGeneration = async (
  text: string,
  memeType: MemeType,
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

      const sanitizedInput = text.replace(/(\r\n|\n|\r)/gm, "");
      console.log(`Sanitized question: ${sanitizedInput}`);

      const moderationReponse = await createModeration({
        input: sanitizedInput,
      });
      if (moderationReponse?.results?.[0]?.flagged) {
        console.error("Question is not allowed");
        await sendMessage(chatId, MODERATION_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const estimatedTokensForEmbeddingsRequest =
        estimateEmbeddingTokens(sanitizedInput);
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

      const prompt =
        `Return the two options for ${memeType} meme about: ` +
        sanitizedInput +
        ". do not return any explaination, just return the list. only return one list. make it funny.";

      const payload = getPayload(prompt, "gpt-3.5-turbo", false, [
        {
          role: "system",
          content: `I am creating a ${memeType} meme. In this meme, Drake disapproves of the first option and approves of the second option. Please provide two short phrases or words for each option, where the first phrase represents a less desirable approach and the second phrase is the more desirable approach. Format your response as a Javascript list, like this: [option1, option2]`,
        },
        { role: "user", content: prompt },
      ]);

      const completion = await createCompletion(payload);

      if (!completion) {
        console.error(`Completion error: `, completion);
        sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const totalTokensUsedForCompletionRequest =
        completion?.usage?.total_tokens || 0;
      const totalTokensUsed = totalTokensUsedForCompletionRequest;
      const remainingTokens = totalTokensRemaining - totalTokensUsed;

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

      console.log(`Completion: `, JSON.stringify(completion, null, 2));

      const regex = /"((?:\\"|[^"])*)"/g;

      const content = completion.choices[0].message?.content as string;

      const match = content.match(regex);

      if (!match || match.length < 2) {
        console.error("No match found");
        sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const matches = match.map((match) => match.slice(1, -1));

      const url = "https://api.imgflip.com/caption_image";

      const imgFlipPayload = {
        template_id: MEME_OPTIONS.find((meme) => meme.name === memeType)
          ?.template_id as string,
        username: process.env.IMG_FLIP_USERNAME as string,
        password: process.env.IMG_FLIP_PASSWORD as string,
        text0: matches[0],
        text1: matches[1],
        font: "impact",
        max_font_size: "50",
      };

      const formBody = new URLSearchParams(imgFlipPayload).toString();

      const imgFlipUploadResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody,
      });

      const new_image = await imgFlipUploadResponse.json();

      if (!new_image.success) {
        console.error("ImgFlip upload error: ", new_image);
        await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      await sendDocument(chatId, new_image.data.url, {
        caption: GENERATED_MEME_MESSAGE,
        reply_to_message_id: messageId,
      });

      // get a json object from the response
      //   sendMessage(chatId,completion.choices[0].message?.content as string, {
      //     reply_to_message_id: messageId,
      //   });
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
