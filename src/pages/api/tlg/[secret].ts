import {
  HELP_MESSAGE,
  WELCOME_MESSAGE,
  TELEGRAM_FILE_SIZE_LIMIT,
  INVALID_COMMAND_MESSAGE,
  SUPPORT_HELP_MESSAGE,
  TERMS_AND_CONDITIONS,
  PRICING_PLANS,
  PRICING_PLANS_MESSAGE,
  IMAGE_GENERATION_MESSAGE,
  IMAGE_GENERATION_OPTIONS,
  INVALID_FILE_MESSAGE,
  TEXT_GENERATION_MESSAGE,
  TEXT_GENERATION_OPTIONS,
  PROCESSING_BACKGROUND_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  FILE_SIZE_EXCEEDED_MESSAGE,
  INITIAL_IMAGE_GENERATION_COUNT,
  INITIAL_TOKEN_COUNT,
  USER_CREATION_ERROR_MESSAGE,
  TELEGRAM_IMAGE_SIZE_LIMIT,
  IMAGE_SIZE_EXCEEDED_MESSAGE,
  INSUFFICIENT_TOKENS_MESSAGE,
  MIN_PROMPT_LENGTH,
  MIN_PROMPT_MESSAGE,
  INVALID_PRICING_PLAN_MESSAGE,
  MAX_PROMPT_LENGTH,
  MAX_PROMPT_MESSAGE,
  UNANSWERED_QUESTION_MESSAGE,
  MODERATION_ERROR_MESSAGE,
  MAX_TOKENS_COMPLETION,
} from "@/utils/constants";
import {
  checkCompletionsRateLimits,
  checkUserRateLimit,
  getEmbeddingsRateLimitResponse,
  imageGenerationRateLimit,
} from "@/lib/rate-limit";
import { NextApiRequest, NextApiResponse } from "next";
// import { generateEmbeddings } from "@/lib/generateEmbeddings";
import {
  createNewUser,
  getUserDataFromDatabase,
  createNewPayment,
  updateImageAndTokensTotal,
} from "@/lib/supabase";
import { bytesToMegabytes } from "@/utils/bytesToMegabytes";
import { getRedisClient, hget, hgetAll, hmset, redlock } from "@/lib/redis";

import { ConversionModel, UserInfoCache } from "@/types";
import { PreCheckoutQuery } from "telegraf/typings/core/types/typegram";
import { qStash } from "@/lib/qstash";
import { bot } from "@/lib/bot";
import { INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE } from "@/utils/constants";
import { PdfBody } from "@/lib/pdf";
import { ImageBody } from "@/lib/image";
import { createCompletion, createModeration, getPayload } from "@/lib/openai";
import { estimateTotalCompletionTokens } from "@/utils/tokenizer";

const tlg = async (req: NextApiRequest, res: NextApiResponse) => {
  // Rate limiting middleware
  bot.use(async (ctx, next) => {
    if (ctx.message?.from.is_bot) {
      return;
    }

    let userId = null;

    if (ctx.message && ctx.message.from) {
      userId = ctx.message.from.id;
    } else if (ctx.update && (ctx.update as any).callback_query) {
      userId = (ctx.update as any).callback_query.from.id;
    } else if (ctx.update && (ctx.update as any).pre_checkout_query) {
      userId = (ctx.update as any).pre_checkout_query.from.id;
    } else {
      console.error("User id not found");
      return;
    }

    const rateLimitResult = await checkUserRateLimit(userId as number);

    if (!rateLimitResult.result.success) {
      console.error("Rate limit exceeded");
      ctx.reply(
        getEmbeddingsRateLimitResponse(
          rateLimitResult.hours,
          rateLimitResult.minutes
        )
      );
      return;
    }

    await next();
  });

  // User data middleware
  bot.use(async (ctx, next) => {
    if (ctx.message?.from.is_bot) {
      return;
    }

    let userId = null;

    if (ctx.message && ctx.message.from) {
      userId = ctx.message.from.id;
    } else if (ctx.update && (ctx.update as any).callback_query) {
      userId = (ctx.update as any).callback_query.from.id;
    } else if (ctx.update && (ctx.update as any).pre_checkout_query) {
      userId = (ctx.update as any).pre_checkout_query.from.id;
    } else {
      console.log(ctx);
      console.error("User id not found");
      return;
    }

    const key = `user:${userId}`;
    let userDataCache = await hgetAll(key);
    console.log(`User from cache: `, userDataCache);

    if (!userDataCache || !Object.keys(userDataCache).length) {
      let userDataFromDB = await getUserDataFromDatabase(userId as number);

      if (userDataFromDB) {
        await hmset(key, {
          tokens: userDataFromDB.tokens,
          image_generations_remaining:
            userDataFromDB.image_generations_remaining,
        });
      } else {
        userDataFromDB = await createNewUser({
          user_id: userId as number,
          first_name: ctx.message?.from.first_name,
          last_name: ctx.message?.from.last_name,
          image_generation_total: INITIAL_IMAGE_GENERATION_COUNT,
          image_generations_remaining: INITIAL_IMAGE_GENERATION_COUNT,
          tokens: INITIAL_TOKEN_COUNT,
        });
        if (!userDataFromDB) {
          console.error("Error creating new user");
          ctx.reply(USER_CREATION_ERROR_MESSAGE);
          return;
        }
        await hmset(key, {
          tokens: userDataFromDB.tokens,
          image_generations_remaining:
            userDataFromDB.image_generations_remaining,
        });
      }
      ctx.userData = {
        tokens: +(userDataFromDB.tokens || 0),
        image_generations_remaining: +(
          userDataFromDB.image_generations_remaining || 0
        ),
      };
    } else {
      ctx.userData = {
        tokens: +userDataCache.tokens,
        image_generations_remaining: +userDataCache.image_generations_remaining,
      };
    }

    await next();
  });

  // start command
  bot.start(async (ctx) => {
    const messageId = ctx.message.message_id;
    ctx.reply(WELCOME_MESSAGE, {
      reply_to_message_id: messageId,
    });
  });

  // help command
  bot.help((ctx) => {
    const messageId = ctx.message.message_id;
    ctx.reply(HELP_MESSAGE, {
      reply_to_message_id: messageId,
    });
  });

  // callback for image generation and question completion
  bot.on("callback_query", async (ctx) => {
    let message = ctx.callbackQuery.message as any;

    if (!message.reply_to_message) {
      ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE);
      return;
    }

    message = message.reply_to_message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const userId = message.from.id;
    const { data } = ctx.callbackQuery as any;
    const userData = ctx.userData as UserInfoCache;

    console.log(`Callback data: `, data);

    if (
      data == "Room" ||
      data == "Restore" ||
      data == "Scribble" ||
      data == "Imagine"
    ) {
      if ((userData.image_generations_remaining as number) <= 0) {
        ctx.reply(INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }
    }

    if (data == "Question") {
      if ((userData.tokens as number) <= 0) {
        ctx.reply(INSUFFICIENT_TOKENS_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }
    }

    if (data == "Room" || data == "Restore" || data == "Scribble") {
      try {
        ctx.reply(PROCESSING_BACKGROUND_MESSAGE, {
          reply_to_message_id: messageId,
        });

        let fileId = "";
        if (message.document) {
          fileId = message.document.file_id;
        } else if (message.photo) {
          fileId = message.photo[message.photo.length - 1].file_id;
        } else {
          console.error("Invalid file type");
          ctx.reply(INVALID_FILE_MESSAGE, {
            reply_to_message_id: messageId,
          });
        }

        const body: ImageBody = {
          chatId: chatId,
          messageId: messageId,
          fileId,
          userId: userId,
          conversionModel:
            data == "Room"
              ? ConversionModel.CONTROLNET_HOUGH
              : data == "Scribble"
              ? ConversionModel.CONTROLNET_SCRIBBLE
              : ConversionModel.GFPGAN,
        };

        const qStashPublishResponse = await qStash.publishJSON({
          url: `${process.env.QSTASH_URL}/image` as string,
          body,
          retries: 0,
        });
        if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
          ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          });
        }
        console.log(`QStash Response: ${qStashPublishResponse.messageId}`);
      } catch (err) {
        console.error(err);
        ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
      }
    } else if (data == "Imagine") {
      try {
        const { text } = message;
        ctx.reply(PROCESSING_BACKGROUND_MESSAGE, {
          reply_to_message_id: messageId,
        });

        const body: ImageBody = {
          chatId: chatId,
          messageId: messageId,
          prompt: text,
          userId: userId,
          conversionModel: ConversionModel.OPENJOURNEY,
        };

        const qStashPublishResponse = await qStash.publishJSON({
          url: `${process.env.QSTASH_URL}/image` as string,
          body,
          retries: 0,
        });
        if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
          ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          });
        }
        console.log(`QStash Response: ${qStashPublishResponse.messageId}`);
      } catch (err) {
        console.error(err);
        ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
      }
    } else if (data == "General Question") {
      const { text } = message;

      // Acquire a lock on the user resource
      const userKey = `user:${userId}`;
      const userLockResource = `locks:user:image:${userId}`;
      try {
        let lock = await redlock.acquire([userLockResource], 2 * 60 * 1000);

        try {
          const rateLimitResult = await checkCompletionsRateLimits(userId);

          if (!rateLimitResult.result.success) {
            console.error("Rate limit exceeded");
            ctx.reply(
              getEmbeddingsRateLimitResponse(
                rateLimitResult.hours,
                rateLimitResult.minutes,
                rateLimitResult.seconds
              ),
              {
                reply_to_message_id: messageId,
              }
            );
            return;
          }

          const sanitizedQuestion = text.replace(/(\r\n|\n|\r)/gm, "");

          const moderationReponse = await createModeration(sanitizedQuestion);
          if (moderationReponse?.results?.[0]?.flagged) {
            console.error("Question is not allowed");
            ctx.reply(MODERATION_ERROR_MESSAGE, {
              reply_to_message_id: messageId,
            });
            return;
          }

          const totalTokensRemaining = parseInt(
            (await hget(userKey, "tokens")) || "0"
          );
          console.log(`Total tokens remaining: ${totalTokensRemaining}`)

          const estimatedTokensForRequest =
            estimateTotalCompletionTokens(sanitizedQuestion);
          console.log(
            `Estimated tokens for request: ${estimatedTokensForRequest}`
          );

          if (totalTokensRemaining < estimatedTokensForRequest) {
            console.error("Insufficient tokens");
            ctx.reply(INSUFFICIENT_TOKENS_MESSAGE, {
              reply_to_message_id: messageId,
            });
          }

          await ctx.sendChatAction("typing");

          const body = getPayload(sanitizedQuestion, "gpt-3.5-turbo");
          const completion = await createCompletion(body);
          const tokensUsed = completion?.usage?.total_tokens || 0;
          const totalTokensRemainingAfterRequest =
            totalTokensRemaining - tokensUsed;
          console.log(`Tokens used total: ${tokensUsed}, prompt tokens: ${completion?.usage?.prompt_tokens}, completion tokens: ${completion?.usage?.completion_tokens}`);

          const redisMulti = getRedisClient().multi(); // Start a transaction
          redisMulti.hset(userKey, {
            tokens: totalTokensRemainingAfterRequest,
          });
          await redisMulti.exec();

          const answer =
            completion?.choices[0]?.message?.content ||
            UNANSWERED_QUESTION_MESSAGE;
          await ctx.reply(answer, {
            reply_to_message_id: messageId,
          });
        } catch (err) {
          console.error(err);
          ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          });
        } finally {
          lock.release();
        }
      } catch (err) {
        // Release the lock
        console.error(err);
        ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
      }
    } else if (data == "PDF Question") {
      ctx.reply("Pdf Question", {
        reply_to_message_id: messageId,
      });
    } else if (
      data == "Basic Plan" ||
      data == "Pro Plan" ||
      data == "Business Plan"
    ) {
      const plan = PRICING_PLANS.find((plan) => plan.title == data);

      if (!plan) {
        ctx.reply(INVALID_PRICING_PLAN_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      const invoiceParams = {
        title: plan.title,
        description: plan.description,
        payload: plan.title,
        provider_token: process.env.TELEGRAM_BOT_STRIPE_TOKEN as string,
        currency: "usd",
        prices: [{ label: plan.title, amount: plan.price * 100 }],
      };

      ctx.replyWithInvoice(invoiceParams, {
        reply_to_message_id: messageId,
      });
    } else {
      ctx.reply(INVALID_COMMAND_MESSAGE, {
        reply_to_message_id: messageId,
      });
    }
    ctx.answerCbQuery();
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const preCheckoutQuery = ctx.update.pre_checkout_query as PreCheckoutQuery;
    const { total_amount, invoice_payload } = preCheckoutQuery;

    // check if product is valid
    const product = PRICING_PLANS.find(
      (plan) =>
        plan.title == invoice_payload && plan.price == total_amount / 100
    );
    if (!product) {
      ctx.answerPreCheckoutQuery(false, INVALID_PRICING_PLAN_MESSAGE);
      return;
    }

    // TODO: log transcation details
    ctx.answerPreCheckoutQuery(true);
  });

  bot.command("limit", async (ctx) => {
    const messageId = ctx.message.message_id;
    const { image_generations_remaining, tokens } = ctx.userData;
    ctx.reply(
      `🚀 Greetings from InsightAI! 🚀

You have access to:
    
🎨 Image Generations: ${image_generations_remaining} image generations to create stunning visuals and explore new possibilities.
    
📚 Tokens: ${tokens} tokens for efficient file processing and seamless interaction with your content.
    
🌟 Let your imagination soar with InsightAI! 🌟`,
      {
        reply_to_message_id: messageId,
      }
    );
  });

  // bot.command("dt", async (ctx) => {
  //   const urls = await getUserUrls(ctx.message.from.id);
  //   const messageId = ctx.message.message_id;

  //   if (urls.length === 0) {
  //     ctx.reply("You have not yet trained any datasets", {
  //       reply_to_message_id: messageId,
  //     });
  //     return;
  //   }
  //   const message = urls.map((url) => url.url).join("\n");
  //   ctx.reply("Here are the datasets you have trained: \n" + message, {
  //     reply_to_message_id: messageId,
  //   });
  // });

  // bot.command("url", async (ctx) => {
  //   const url = ctx.message.text.split(" ")[1];
  //   if (!url) {
  //     ctx.reply("Please provide a url");
  //     return;
  //   }
  //   const isValid = await isValidUrl(url);
  //   if (!isValid) {
  //     ctx.reply("Please provide a valid url");
  //     return;
  //   }

  //   const isProcessedUrl = await isProcessed(ctx.message.from.id, url);
  //   if (isProcessedUrl) {
  //     ctx.reply("This url has already been processed");
  //     return;
  //   }

  //   if (processing) {
  //     ctx.reply("Please wait, I am still processing your last request");
  //     return;
  //   }

  //   const rateLimitResult = await checkEmbeddingsRateLimit(
  //     "url",
  //     ctx.message.from.id
  //   );

  //   res.setHeader("X-RateLimit-Limit", rateLimitResult.result.limit);
  //   res.setHeader("X-RateLimit-Remaining", rateLimitResult.result.remaining);

  //   if (!rateLimitResult.result.success) {
  //     console.error("Rate limit exceeded");
  //     ctx.reply(
  //       getEmbeddingsRateLimitResponse(
  //         rateLimitResult.hours,
  //         rateLimitResult.minutes
  //       )
  //     );
  //     processing = false;
  //     return;
  //   }

  //   ctx.reply("Received your request, processing in the background...", {
  //     reply_to_message_id: ctx.message.message_id,
  //   });

  //   eventEmitter.emit(
  //     "processInBackground",
  //     url,
  //     ctx.message.from.id,
  //     "url",
  //     ctx
  //   );
  // });

  bot.command("plans", async (ctx) => {
    const messageId = ctx.message.message_id;

    ctx.reply(PRICING_PLANS_MESSAGE, {
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: PRICING_PLANS.map((plan) => {
          return [
            {
              text: plan.title,
              callback_data: plan.title,
            },
          ];
        }),
      },
    });
  });

  bot.command("support", async (ctx) => {
    const messageId = ctx.message.message_id;
    ctx.reply(SUPPORT_HELP_MESSAGE, {
      reply_to_message_id: messageId,
    });
  });

  bot.command("terms", async (ctx) => {
    const messageId = ctx.message.message_id;
    ctx.reply(TERMS_AND_CONDITIONS, {
      reply_to_message_id: messageId,
    });
  });

  // bot.on("voice", async (ctx) => {
  //   const messageId = ctx.message.message_id;

  //   if (processing) {
  //     ctx.reply("Please wait, I am still processing your last request", {
  //       reply_to_message_id: messageId,
  //     });
  //     return;
  //   }

  //   const rateLimitResult = await checkCompletionsRateLimits(
  //     ctx.message.from.id
  //   );

  //   if (!rateLimitResult.result.success) {
  //     console.error("Rate limit exceeded");
  //     ctx.reply(
  //       "Too many requests, please try again in " +
  //         rateLimitResult.hours +
  //         " hours and " +
  //         rateLimitResult.minutes +
  //         " minutes"
  //     );
  //     return;
  //   }

  //   const fileId = ctx.update.message.voice.file_id;
  //   const fileLink = await ctx.telegram.getFileLink(fileId);

  //   const response = await fetch(fileLink);
  //   const arrayBuffer = await response.arrayBuffer();
  //   const fileBuffer = Buffer.from(arrayBuffer);

  //   const localFilePath = `${fileId}.oga`;
  //   writeFileSync(localFilePath, fileBuffer);

  //   const wavFilePath = `${fileId}.wav`;
  //   await convertToWav(localFilePath, wavFilePath);

  //   try {
  //     const openai = new OpenAIApi(configuration);
  //     const resp = await openai.createTranslation(
  //       createReadStream(wavFilePath) as any,
  //       "whisper-1"
  //     );
  //     const { text: question } = resp.data;
  //     const sanitizedQuestion = question.replace(/(\r\n|\n|\r)/gm, "");

  //     const moderationReponse = await createModeration(sanitizedQuestion);
  //     if (moderationReponse?.results?.[0]?.flagged) {
  //       ctx.reply("Your question is not allowed per OpenAI's guidelines");
  //       return;
  //     }

  //     ctx.sendChatAction("typing");

  //     let embeddingResult: CreateEmbeddingResponse | undefined = undefined;
  //     // Retry with exponential backoff in case of error. Typically, this is due to too_many_requests
  //     embeddingResult = await backOff(
  //       () => createEmbedding(sanitizedQuestion),
  //       {
  //         startingDelay: 1000,
  //         numOfAttempts: 10,
  //       }
  //     );

  //     const promptEmbedding = embeddingResult?.data?.[0]?.embedding;

  //     if (!promptEmbedding) {
  //       ctx.reply("Sorry, an error occured. Please try again later");
  //       return;
  //     }

  //     const { data: documents, error } = await supabaseClient.rpc(
  //       "match_documents",
  //       {
  //         query_embedding: promptEmbedding,
  //         similarity_threshold: 0.1,
  //         match_count: 10,
  //       }
  //     );

  //     if (error) {
  //       console.error(error);
  //       ctx.reply("Sorry, an error occured. Please try again later");
  //       return;
  //     }

  //     if (!documents || documents.length === 0) {
  //       ctx.reply("Sorry, I could not find any matching documents");
  //       return;
  //     }

  //     let tokenCount = 0;
  //     let contextText = "";

  //     // Concat matched documents
  //     for (let i = 0; i < documents.length; i++) {
  //       const document = documents[i];
  //       const content = document.content;
  //       const url = document.url;
  //       tokenCount += document.token_count;

  //       // Limit context to max 1500 tokens (configurable)
  //       if (tokenCount > CONTEXT_TOKENS_CUTOFF) {
  //         break;
  //       }

  //       contextText += `${content.trim()}\nSOURCE: ${url}\n---\n`;
  //     }

  //     const prompt = `\
  //     You are a helpful assistant. When given CONTEXT you answer questions using only that information,
  //     and you always format your output in markdown. You include code snippets if relevant. If you are unsure and the answer
  //     is not explicitly written in the CONTEXT provided, you say
  //     "Sorry, I don't know how to help with that." If the CONTEXT includes
  //     source URLs include them under a SOURCES heading at the end of your response. Always include all of the relevant source urls
  //     from the CONTEXT, but never list a URL more than once (ignore trailing forward slashes when comparing for uniqueness). Never include URLs that are not in the CONTEXT sections. Never make up URLs

  // CONTEXT:
  // ${contextText}

  // QUESTION: """
  // ${sanitizedQuestion}
  // """`;

  //     const payload = getPayload(prompt, "gpt-3.5-turbo");

  //     const completion = await fetch(
  //       "https://api.openai.com/v1/chat/completions",
  //       {
  //         headers: {
  //           "Content-Type": "application/json",
  //           Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
  //         },
  //         method: "POST",
  //         body: JSON.stringify(payload),
  //       }
  //     );

  //     if (!completion.ok) {
  //       console.error(completion);
  //       ctx.reply("Sorry, an error occured. Please try again later");
  //       return;
  //     }

  //     // get a json object from the response
  //     const { choices } = await completion.json();
  //     ctx.reply(choices[0].message.content, { reply_to_message_id: messageId });
  //     processing = false;
  //   } catch (err) {
  //     console.error(err);
  //     ctx.reply("Sorry, an error occured. Please try again later");
  //   } finally {
  //     unlinkSync(localFilePath);
  //     unlinkSync(wavFilePath);
  //   }
  // });

  bot.on("message", async (ctx) => {
    const message = ctx.message as any;
    const fromId = message.from.id;
    const chatId = message.chat.id;
    const messageId = message.message_id;

    // check if message end with question mark
    if (message.text) {
      const { text } = ctx.message as any;

      if (text.length < MIN_PROMPT_LENGTH) {
        ctx.reply(MIN_PROMPT_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      if (text.length > MAX_PROMPT_LENGTH) {
        ctx.reply(MAX_PROMPT_MESSAGE, {
          reply_to_message_id: messageId,
        });
        return;
      }

      ctx.reply(TEXT_GENERATION_MESSAGE, {
        reply_to_message_id: messageId,
        reply_markup: {
          inline_keyboard: TEXT_GENERATION_OPTIONS.map((e) => {
            return [
              {
                text: e.title,
                callback_data: e.title,
              },
            ];
          }),
        },
      });

      return;

      //     const question = (ctx.message as any).text;
      //     if (question.length > MAX_PROMPT_LENGTH) {
      //       ctx.reply("Please shorten your question");
      //       return;
      //     }

      //     const rateLimitResult = await checkCompletionsRateLimits(
      //       ctx.message.from.id
      //     );

      //     if (!rateLimitResult.result.success) {
      //       console.error("Rate limit exceeded");
      //       ctx.reply(
      //         "Too many requests, please try again in " +
      //           rateLimitResult.hours +
      //           " hours and " +
      //           rateLimitResult.minutes +
      //           " minutes"
      //       );
      //       return;
      //     }

      //     const sanitizedQuestion = question.replace(/(\r\n|\n|\r)/gm, "");

      //     const moderationReponse = await createModeration(sanitizedQuestion);
      //     if (moderationReponse?.results?.[0]?.flagged) {
      //       console.error("Question is not allowed");
      //       ctx.reply("Your question is not allowed per OpenAI's guidelines");
      //       return;
      //     }

      //     ctx.sendChatAction("typing");

      //     let embeddingResult: CreateEmbeddingResponse | undefined = undefined;
      //     try {
      //       // Retry with exponential backoff in case of error. Typically, this is due to too_many_requests
      //       embeddingResult = await backOff(
      //         () => createEmbedding(sanitizedQuestion),
      //         {
      //           startingDelay: 1000,
      //           numOfAttempts: 10,
      //         }
      //       );
      //     } catch (error) {
      //       console.error(error);
      //       ctx.reply("Sorry, an error occured. Please try again later");
      //       return;
      //     }

      //     const promptEmbedding = embeddingResult?.data?.[0]?.embedding;

      //     if (!promptEmbedding) {
      //       ctx.reply("Sorry, an error occured. Please try again later");
      //       return;
      //     }

      //     const { data: documents, error } = await supabaseClient.rpc(
      //       "match_documents",
      //       {
      //         query_embedding: promptEmbedding,
      //         similarity_threshold: 0.1,
      //         match_count: 10,
      //       }
      //     );

      //     if (error) {
      //       console.error(error);
      //       ctx.reply("Sorry, an error occured. Please try again later");
      //       return;
      //     }

      //     if (!documents || documents.length === 0) {
      //       ctx.reply("Sorry, I could not find any matching documents");
      //       return;
      //     }

      //     let tokenCount = 0;
      //     let contextText = "";

      //     // Concat matched documents
      //     for (let i = 0; i < documents.length; i++) {
      //       const document = documents[i];
      //       const content = document.content;
      //       const url = document.url;
      //       tokenCount += document.token_count;

      //       // Limit context to max 1500 tokens (configurable)
      //       if (tokenCount > CONTEXT_TOKENS_CUTOFF) {
      //         break;
      //       }

      //       contextText += `${content.trim()}\nSOURCE: ${url}\n---\n`;
      //     }

      //     const prompt = `\
      //     You are a helpful assistant. When given CONTEXT you answer questions using only that information,
      //     and you always format your output in markdown. You include code snippets if relevant. If you are unsure and the answer
      //     is not explicitly written in the CONTEXT provided, you say
      //     "Sorry, I don't know how to help with that." If the CONTEXT includes
      //     source URLs include them under a SOURCES heading at the end of your response. Always include all of the relevant source urls
      //     from the CONTEXT, but never list a URL more than once (ignore trailing forward slashes when comparing for uniqueness). Never include URLs that are not in the CONTEXT sections. Never make up URLs

      // CONTEXT:
      // ${contextText}

      // QUESTION: """
      // ${sanitizedQuestion}
      // """`;

      //     const payload = getPayload(prompt, "gpt-3.5-turbo");

      //     const completion = await fetch(
      //       "https://api.openai.com/v1/chat/completions",
      //       {
      //         headers: {
      //           "Content-Type": "application/json",
      //           Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      //         },
      //         method: "POST",
      //         body: JSON.stringify(payload),
      //       }
      //     );

      //     if (!completion.ok) {
      //       console.error(completion);
      //       ctx.reply("Sorry, an error occured. Please try again later");
      //       return;
      //     }

      //     // get a json object from the response
      //     const { choices } = await completion.json();
      //     ctx.reply(choices[0].message.content, { reply_to_message_id: messageId });
      //     processing = false;
    }

    //  check if message is a successful payment
    else if (message.successful_payment) {
      // #TODO: update user's tokens and image generations , and send a message
      const { from, successful_payment } = ctx.message as any;
      const userKey = `user:${from.id}`;
      const userImageLockResource = `locks:user:image:${from.id}`;
      const userPdfLockResoruce = `locks:user:pdf:${from.id}`;
      try {
        let lock = await redlock.acquire(
          [userImageLockResource, userPdfLockResoruce],
          5 * 60 * 1000
        );
        const {
          total_amount,
          currency,
          invoice_payload,
          telegram_payment_charge_id,
          provider_payment_charge_id,
        } = successful_payment;
        const decimalAmount = total_amount / 100;

        const purchased_image_generations =
          total_amount == 999 ? 10 : total_amount == 2499 ? 30 : 80;
        const purchased_tokens =
          total_amount == 999 ? 70000 : total_amount == 2499 ? 350000 : 1500000;

        try {
          const paymentCreationResult = await createNewPayment({
            user_id: from.id,
            amount: decimalAmount,
            currency,
            purchased_image_generations,
            purchased_tokens,
            provider_payment_charge_id,
            telegram_payment_charge_id,
            payment_method: "Credit Card",
            payment_status: "Paid",
          });

          if (!paymentCreationResult) {
            console.error("Payment unsuccessfully stored in db");
            console.error("Payment details: ", successful_payment);
            ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: messageId,
            });
          }

          const userUpdateResult = await updateImageAndTokensTotal(
            from.id,
            purchased_image_generations,
            purchased_tokens
          );

          if (!userUpdateResult) {
            console.error("User unsuccessfully updated in db");
            console.error("Payment details: ", successful_payment);
            ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: messageId,
            });
          }

          const redisMulti = getRedisClient().multi(); // Start a transaction
          redisMulti
            .hincrby(userKey, "tokens", purchased_tokens)
            .hincrby(
              userKey,
              "image_generations_remaining",
              purchased_image_generations
            );
          await redisMulti.exec(); // Execute the transaction

          ctx.reply(
            `🚀 Welcome to the ${invoice_payload} on InsightAI! You've unlocked: 🚀
            
🎨 Image Generations: ${purchased_image_generations} image generations to create captivating visuals and explore new possibilities.
            
📚 Tokens for File Processing: ${purchased_tokens.toLocaleString()} tokens to help you process files and uncover greater insights.
            
Learn more about your current limit at /limit. Thank you for choosing us, and we wish you a fantastic journey ahead! 😊🌟`,
            {
              reply_to_message_id: messageId,
            }
          );
        } catch (error) {
          console.error(error);
          console.error("Payment details: ", successful_payment);
          ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          });
        } finally {
          await lock.release();
        }
      } catch (error) {
        console.error(error);
        console.error("Payment details: ", successful_payment);
        ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
          reply_to_message_id: messageId,
        });
      }
    }

    // check if message is a photo
    else if (message.photo) {
      const rateLimitResult = await imageGenerationRateLimit(fromId);

      if (!rateLimitResult.result.success) {
        console.error("Rate limit exceeded");
        ctx.reply(
          getEmbeddingsRateLimitResponse(
            rateLimitResult.hours,
            rateLimitResult.minutes,
            rateLimitResult.seconds
          ),
          {
            reply_to_message_id: messageId,
          }
        );
        return;
      }

      ctx.reply(IMAGE_GENERATION_MESSAGE, {
        reply_to_message_id: messageId,
        reply_markup: {
          inline_keyboard: IMAGE_GENERATION_OPTIONS.map((e) => {
            return [
              {
                text: e.title,
                callback_data: e.title,
              },
            ];
          }),
        },
      });
    }

    // check if message is a document
    else if (message.document) {
      const mimeType = (ctx.message as any).document.mime_type;
      const fileId = (ctx.message as any).document.file_id;
      const fileSize = (ctx.message as any).document.file_size;

      // handle pdf files
      if (mimeType === "application/pdf") {
        try {
          const sizeInMb = bytesToMegabytes(fileSize);
          if (sizeInMb > TELEGRAM_FILE_SIZE_LIMIT) {
            ctx.reply(FILE_SIZE_EXCEEDED_MESSAGE, {
              reply_to_message_id: messageId,
            });
            return;
          }
          ctx.reply(PROCESSING_BACKGROUND_MESSAGE, {
            reply_to_message_id: messageId,
          });

          const body: PdfBody = {
            chatId: chatId,
            messageId: messageId,
            fileId,
            userId: fromId,
          };

          const qStashPublishResponse = await qStash.publishJSON({
            url: `${process.env.QSTASH_URL}/embeddings` as string,
            body,
          });
          if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
            ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: messageId,
            });
          }
          console.log(`QStash Response: ${qStashPublishResponse.messageId}`);
        } catch (err) {
          console.error(err);
          ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          });
        }
      }

      // handle image files
      else if (mimeType === "image/png" || mimeType === "image/jpeg") {
        const rateLimitResult = await imageGenerationRateLimit(fromId);

        if (!rateLimitResult.result.success) {
          console.error("Rate limit exceeded");
          ctx.reply(
            getEmbeddingsRateLimitResponse(
              rateLimitResult.hours,
              rateLimitResult.minutes,
              rateLimitResult.seconds
            ),
            {
              reply_to_message_id: messageId,
            }
          );
          return;
        }

        const sizeInMb = bytesToMegabytes(fileSize);
        if (sizeInMb > TELEGRAM_IMAGE_SIZE_LIMIT) {
          ctx.reply(IMAGE_SIZE_EXCEEDED_MESSAGE, {
            reply_to_message_id: messageId,
          });
          return;
        }

        ctx.reply(IMAGE_GENERATION_MESSAGE, {
          reply_to_message_id: messageId,
          reply_markup: {
            inline_keyboard: IMAGE_GENERATION_OPTIONS.map((e) => {
              return [
                {
                  text: e.title,
                  callback_data: e.title,
                },
              ];
            }),
          },
        });
      } else {
        ctx.reply(INVALID_FILE_MESSAGE, {
          reply_to_message_id: messageId,
        });
      }
    } else {
      ctx.reply(INVALID_COMMAND_MESSAGE, {
        reply_to_message_id: messageId,
      });
    }
  });

  bot.catch((err, ctx) => {
    console.log(`Ooops, encountered an error for ${ctx.updateType}`, err);
    ctx.reply(INTERNAL_SERVER_ERROR_MESSAGE, {
      reply_to_message_id: (ctx.message as any).message_id,
    });
  });

  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error(err);
  }

  return res.status(200).end();
};

export default tlg;
