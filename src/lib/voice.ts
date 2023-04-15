
import { createReadStream, unlinkSync, writeFileSync } from "fs";
import { convertToWav, getFileSizeInMb } from "@/utils/convertToWav";
import { processImagePromptOpenJourney } from "@/lib/image";
import { TelegramBot } from "@/types";
import { getRedisClient, hget, lock } from "@/lib/redis";
import { calculateWhisperTokens } from "@/utils/tokenizer";
import { getFile, sendDocument, sendMessage } from "@/lib/bot";
import { AUIDO_FILE_EXCEEDS_LIMIT_MESSAGE, INSUFFICIENT_TOKENS_MESSAGE, INTERNAL_SERVER_ERROR_MESSAGE, OPEN_AI_AUDIO_LIMIT, WORKING_ON_NEW_FEATURES_MESSAGE } from "@/utils/constants";
import { createTranslation } from "@/lib/openai";
import { updateUserTokens } from "@/lib/supabase";
import { processGeneralQuestion, processPdfQuestion } from "@/lib/question";
import fs from 'fs';
import path from 'path';
import os from 'os'

export interface VoiceBody {
  message: TelegramBot.Message,
  userId: number,
  questionType: string,
}


/**
 * Voice message handler
 * 
 * @param fileId 
 * @param message 
 * @param userId 
 * @param questionType 
 * @returns 
 */
export const processVoice = async (
    message: VoiceBody["message"],
    userId: VoiceBody["userId"], 
    questionType: VoiceBody["questionType"]
  ): Promise<void> => {
    const {chat: {id: chatId}, message_id: messageId} = message;
    if (questionType == 'Goal') {
      await sendMessage(chatId, WORKING_ON_NEW_FEATURES_MESSAGE, {
        reply_to_message_id: messageId
      })
      return;
    }
            console.log(`Question type: ${questionType}`)
           // convert audio to text and send to question completion, then delete audio
           // Acquire a lock on the user resource
           const key = `user:${userId}`;
           const userLockResource = `locks:user:token:${userId}`;
          const {duration, file_id} = message.voice as TelegramBot.Voice;
           try {
             let unlock = await lock(userLockResource);
   
             try {
   
           const totalTokens = parseInt((await hget(key, "tokens")) || "0");
           console.log(`Total tokens before request: `, totalTokens)
           const tokensToProcessAudio = calculateWhisperTokens(duration);
   
           if (totalTokens < tokensToProcessAudio) {
             await sendMessage(chatId, INSUFFICIENT_TOKENS_MESSAGE, {
               reply_to_message_id: messageId,
             });
             return;
           }
   
         const file = await getFile(file_id);
         const file_path = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`
         if (!file_path) {
           await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
             reply_to_message_id: messageId,
             });
           return;
         }
         console.log(`File path: ${file_path}`)
         const response = await fetch(file_path);
         const arrayBuffer = await response.arrayBuffer();
         const fileBuffer = Buffer.from(arrayBuffer);
   
         const tempDir = os.tmpdir();
         const tempFilePath = path.join(tempDir, `${file_id}.oga` );
         fs.writeFileSync(tempFilePath, fileBuffer);

         const tempDir2 = os.tmpdir();
         const tempFilePath2 = path.join(tempDir2, `${file_id}.wav` );
         await convertToWav(tempFilePath, tempFilePath2);
         const fileSizeInMb = getFileSizeInMb(tempFilePath2);
   
         if (fileSizeInMb > OPEN_AI_AUDIO_LIMIT) {
           await sendMessage(chatId,AUIDO_FILE_EXCEEDS_LIMIT_MESSAGE, {
             reply_to_message_id: messageId,
           });
           return;
         }
   
         const translationResponse = await createTranslation(createReadStream(tempFilePath2));
   
         if (!translationResponse) {
           await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
             reply_to_message_id: messageId,
           });
           return;
         }
                                       // #TODO: Update in DB
           // process audio updated token
            const newTokenCountTotal = totalTokens - tokensToProcessAudio;
   
             // Update the user's token count in Supabase
           const updateUserTokensDB = await updateUserTokens(userId, newTokenCountTotal);
           if (!updateUserTokensDB) {
             console.error(`Unable to update user's token count in the database`);
             await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
               reply_to_message_id: messageId,
             });
             return;
           }
   
       const redisMulti = getRedisClient().multi(); // Start a transaction
       redisMulti.hset(key, {
         tokens: newTokenCountTotal > 0 ? newTokenCountTotal : 0,
       });
       await redisMulti.exec();
   
         const { text: question } = translationResponse;
   
          if (questionType == 'General Question') {
            return await processGeneralQuestion(question, message, userId);
          } else if (questionType == 'PDF Question') {
            return await processPdfQuestion(question, message, userId);
          } else {
            const result = await processImagePromptOpenJourney(question, userId);
            if (result.success) {
              await sendDocument(chatId, result.fileUrl, {
                reply_to_message_id: messageId
              })
            } else {
              await sendMessage(chatId, result.errorMessage, {
                reply_to_message_id: messageId
              })
            }
          }
         } catch (err) {
           console.error(err);
           await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
             reply_to_message_id: messageId,
           });
           return;
         } finally {
           // Release the lock
           await unlock();
         }
         } catch (err) {
           console.error(err);
           await sendMessage(chatId,INTERNAL_SERVER_ERROR_MESSAGE, {
             reply_to_message_id: messageId,
           });
           return;
         }
  }
    