import { backOff } from "exponential-backoff";
import { isProcessed } from "@/utils/isProcessed";
import {
  CONTEXT_TOKENS_CUTOFF,
  HELP_MESSAGE,
  WELCOME_MESSAGE,
  MAX_PROMPT_LENGTH,
  TELEGRAM_FILE_SIZE_LIMIT,
  TOKEN_LIMIT,
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
} from "@/utils/constants";
import {
  checkUserRateLimit,
  getEmbeddingsRateLimitResponse,
  imageGenerationRateLimit,
} from "@/lib/rate-limit";
import { isValidUrl } from "@/utils/isValidUrl";
import { NextApiRequest, NextApiResponse } from "next";
import { CreateEmbeddingResponse, OpenAIApi } from "openai";
import { Context, Markup, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
// import { generateEmbeddings } from "@/lib/generateEmbeddings";
import { getUserUrls } from "@/utils/getUserUrls";
import { createEmbedding, createModeration, getPayload } from "@/lib/openai";
import {
  SelectUser,
  createNewUser,
  getUserDataFromDatabase,
  supabaseClient,
  createNewPayment,
  updateImageAndTokensTotal,
} from "@/lib/supabase";
import { bytesToMegabytes } from "@/utils/bytesToMegabytes";
import {
  getRedisClient,
  getUserEmbeddingsMonthTokenCountKey,
  hget,
  hgetAll,
  hmset,
  hset,
  redlock,
  safeGetObject,
  set,
  setWithExpiration,
} from "@/lib/redis";

import { EventEmitter } from "events";
import { createReadStream, unlinkSync, writeFileSync } from "fs";
import { convertToWav } from "@/utils/convertToWav";
import { ConversionModel, UserInfoCache } from "@/types";
import { LabeledPrice, PreCheckoutQuery } from "telegraf/typings/core/types/typegram";
import { qStash } from "@/lib/qstash";
import { bot } from "@/lib/bot";
import { INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE } from "@/utils/constants";
import { updateUserImageGenerationsRemainingRedis } from "@/lib/image";

const tlg = async (req: NextApiRequest, res: NextApiResponse) => {
  // eventEmitter.on(
  //   "processInBackground",
  //   async function processInBackground(
  //     fileLink: string,
  //     userId: number,
  //     type: "url" | "pdf" | "image",
  //     ctx: any,
  //     conversionModel?: keyof typeof ConversionModel
  //   ) {
  //     let errors = [];

  //     if (type == "pdf" || type == "url") {
  //       errors = await generateEmbeddings(fileLink, userId, type);
  //     } else {
  //       errors = await processImage(
  //         fileLink,
  //         userId,
  //         ctx,
  //         conversionModel || "controlnet-hough"
  //       );
  //     }

  //     if (errors.length > 0) {
  //       console.error("Error processing in background");
  //       ctx.reply("Error processing in background", {
  //         reply_to_message_id: ctx.message.message_id,
  //       });
  //       eventEmitter.removeListener("processInBackground", processInBackground);
  //       return;
  //     }

  //     ctx.reply("Your request is processed", {
  //       reply_to_message_id: ctx.message.message_id,
  //     });

  //     eventEmitter.removeListener("processInBackground", processInBackground);
  //   }
  // );

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

        const qStashPublishResponse = await qStash.publishJSON({
          url: process.env.QSTASH_URL as string,
          body: {
            chatId: chatId,
            messageId: messageId,
            mimeType: "application/jpeg",
            fileId,
            userId: userId,
            conversionModel:
              data == "Room"
                ? ConversionModel["controlnet-hough"]
                : data == "Scribble"
                ? ConversionModel["controlnet-scribble"]
                : ConversionModel["gfpgan"],
          },
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

        const qStashPublishResponse = await qStash.publishJSON({
          url: process.env.QSTASH_URL as string,
          body: {
            chatId: chatId,
            messageId: messageId,
            mimeType: "text/plain",
            userId: userId,
            prompt: text,
          },
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
    } else if (data == "Question") {
      ctx.reply("Question", {
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
      if (message.text.length < MIN_PROMPT_LENGTH) {
        ctx.reply(MIN_PROMPT_MESSAGE, {
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

          const qStashPublishResponse = await qStash.publishJSON({
            url: process.env.QSTASH_URL as string,
            body: {
              chatId: chatId,
              messageId: messageId,
              mimeType,
              fileId,
              userId: fromId,
            },
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

  // bot.on(message("caption"), async (ctx) => {
  //   // validate that the caption is /pdf and file is of type pdf
  //   const messageId = ctx.message.message_id;
  //   if (ctx.message.caption === "/pdf") {
  //     if ((ctx.message as any).document.mime_type !== "application/pdf") {
  //       ctx.reply("Please attach a pdf file", {
  //         reply_to_message_id: messageId,
  //       });
  //       return;
  //     } else {
  //       // validate that the file size is less than 50MB
  //       const sizeInMb = bytesToMegabytes(
  //         (ctx.message as any).document.file_size
  //       );
  //       if (sizeInMb > TELEGRAM_FILE_SIZE_LIMIT) {
  //         ctx.reply("Please attach a pdf file less than 50MB", {
  //           reply_to_message_id: messageId,
  //         });
  //         return;
  //       }

  //       if (processing) {
  //         ctx.reply("Please wait, I am still processing your last request", {
  //           reply_to_message_id: messageId,
  //         });
  //         return;
  //       }

  //       const rateLimitResult = await checkEmbeddingsRateLimit(
  //         "pdf",
  //         ctx.message.from.id
  //       );

  //       res.setHeader("X-RateLimit-Limit", rateLimitResult.result.limit);
  //       res.setHeader(
  //         "X-RateLimit-Remaining",
  //         rateLimitResult.result.remaining
  //       );

  //       if (!rateLimitResult.result.success) {
  //         console.error("Rate limit exceeded");
  //         ctx.reply(
  //           getEmbeddingsRateLimitResponse(
  //             rateLimitResult.hours,
  //             rateLimitResult.minutes
  //           ),
  //           { reply_to_message_id: messageId }
  //         );
  //         processing = false;
  //         return;
  //       }

  //       // download the file
  //       const file = await ctx.telegram.getFile(
  //         (ctx.message as any).document.file_id
  //       );
  //       const fileLink = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`;

  //       ctx.reply("Received your request, processing in the background...", {
  //         reply_to_message_id: ctx.message.message_id,
  //       });

  //       eventEmitter.emit(
  //         "processInBackground",
  //         fileLink,
  //         ctx.message.from.id,
  //         "pdf",
  //         ctx
  //       );
  //     }
  //   } else if (
  //     ctx.message.caption === "/room" ||
  //     ctx.message.caption == "/scribble"
  //   ) {
  //     if ((ctx.message as any).photo) {
  //       const photo = (ctx.message as any).photo;
  //       const file = await ctx.telegram.getFile(
  //         photo[photo.length - 1].file_id
  //       );
  //       const fileLink = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`;

  //       ctx.reply("Received your request, processing in the background...", {
  //         reply_to_message_id: ctx.message.message_id,
  //       });

  //       eventEmitter.emit(
  //         "processInBackground",
  //         fileLink,
  //         ctx.message.from.id,
  //         "image",
  //         ctx,
  //         ctx.message.caption === "/room"
  //           ? ConversionModel["controlnet-hough"]
  //           : ConversionModel["controlnet-scribble"]
  //       );
  //     } else {
  //       ctx.reply("Please attach an image file", {
  //         reply_to_message_id: messageId,
  //       });
  //       return;
  //     }
  //   } else {
  //     ctx.reply(INVALID_COMMAND_MESSAGE, {
  //       reply_to_message_id: messageId,
  //     });
  //   }
  // });

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
