import {
  DEFAULT_MAX_LOOPS_FREE,
  HELP_MESSAGE,
  IMAGE_GENERATION_MESSAGE,
  IMAGE_GENERATION_OPTIONS,
  IMAGE_SIZE_EXCEEDED_MESSAGE,
  INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE,
  INSUFFICIENT_TOKENS_MESSAGE,
  INVALID_COMMAND_MESSAGE,
  INVALID_FILE_MESSAGE,
  INVALID_MESSAGE_TYPE_MESSAGE,
  INVALID_PRICING_PLAN_MESSAGE,
  MEMES_MESSAGE,
  MEME_NAMES,
  MEME_OPTIONS,
  NO_DATASETS_MESSAGE,
  PRICING_PLANS,
  PRICING_PLANS_MESSAGE,
  SUPPORT_HELP_MESSAGE,
  TELEGRAM_IMAGE_SIZE_LIMIT,
  TERMS_AND_CONDITIONS,
  TEXT_VOICE_MESSAGE,
  UNABLE_TO_PROCESS_DOCUMENT_MESSAGE,
} from '@/utils/constants'
import {
  WELCOME_MESSAGE,
  TELEGRAM_FILE_SIZE_LIMIT,
  TEXT_GENERATION_MESSAGE,
  TEXT_GENERATION_OPTIONS,
  PROCESSING_BACKGROUND_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  FILE_SIZE_EXCEEDED_MESSAGE,
  MIN_PROMPT_LENGTH,
  MIN_PROMPT_MESSAGE,
  MAX_PROMPT_LENGTH,
  MAX_PROMPT_MESSAGE,
  AUIDO_FILE_EXCEEDS_LIMIT_MESSAGE,
  OPEN_AI_AUDIO_LIMIT,
} from '@/utils/constants'
import {
  checkCompletionsRateLimits,
  checkUserRateLimit,
  getEmbeddingsRateLimitResponse,
  imageGenerationRateLimit,
} from '@/lib/rate-limit'
import { bytesToMegabytes } from '@/utils/bytesToMegabytes'
import { ConversionModel, Task, TelegramBot } from '@/types'
import { qStash } from '@/lib/qstash'
import { PdfBody } from '@/lib/pdf'
import {
  answerPreCheckoutQuery,
  sendChatAction,
  sendInvoice,
  sendMessage,
} from '@/lib/bot'
import { middleware } from '@/lib/middleware'
import { processGeneralQuestion, processPdfQuestion } from '@/lib/question'
import {
  createNewPayment,
  getUserDistinctUrls,
  updateImageAndTokensTotal,
} from '@/lib/supabase'
import {
  del,
  get,
  getRedisClient,
  lock,
  safeGetObject,
  set,
} from '@/lib/redis'
import { MemeType, processMemeGeneration } from '@/lib/meme'
import { handleAudioRequest } from '@/lib/audio'
import {
  analyzeTaskAgent,
  createTasksAgent,
  executeTaskAgent,
  startGoalAgent,
} from '@/lib/agent'

export const config = {
  runtime: 'edge',
  regions: ['fra1'], // Only execute this function in Frankfurt fra1
}

const tlg = async (req: any, res: any) => {
  const handleUpdate = async (update: TelegramBot.CustomUpdate) => {
    const preprocessing = await middleware(update)
    const { userData } = update
    console.log(`preprocessing: ${preprocessing}`)
    if (!preprocessing || !userData) return

    if (update.message) {
      const { message } = update
      const { from, chat, message_id } = message
      if (!from) return
      const { id: userId } = from
      const { id: chatId } = chat

      // deals with text messages
      if (message.text) {
        const { text } = message

        const rateLimitResult = await checkUserRateLimit(from.id)
        // rate limit exceeded
        if (!rateLimitResult.result.success) {
          console.error('Rate limit exceeded')
          await sendMessage(
            chat.id,
            getEmbeddingsRateLimitResponse(
              rateLimitResult.hours,
              rateLimitResult.minutes,
            ),
          )
          return
        }

        if (text == '/start') {
          await sendMessage(chatId, WELCOME_MESSAGE)
        } else if (text == '/help') {
          await sendMessage(chatId, HELP_MESSAGE, {
            reply_to_message_id: message_id,
          })
        } else if (text == '/limit') {
          await sendMessage(
            chatId,
            `🚀 Greetings from InsightAI! 🚀

You have access to:
    
🎨 Image Generations: ${userData.image_generations_remaining} image generations to create stunning visuals and explore new possibilities.
    
📚 Tokens: ${userData.tokens} tokens for efficient file processing and seamless interaction with your content.
    
🌟 Let your imagination soar with InsightAI! 🌟`,
            {
              reply_to_message_id: message_id,
            },
          )
        } else if (text == '/dt') {
          const urls = await getUserDistinctUrls(userId)
          if (!urls) {
            await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: message_id,
            })
            return
          }
          if (urls.length == 0) {
            await sendMessage(chatId, NO_DATASETS_MESSAGE, {
              reply_to_message_id: message_id,
            })
            return
          }
          const message = (urls as string[]).join('\n')
          await sendMessage(
            chatId,
            "👋 Here's a list of all the PDF files I've processed and trained my model on. 📚💻 \n\n" +
              message,
            {
              reply_to_message_id: message_id,
            },
          )
        } else if (text == '/support') {
          await sendMessage(chatId, SUPPORT_HELP_MESSAGE, {
            reply_to_message_id: message_id,
          })
        } else if (text == '/terms') {
          await sendMessage(chatId, TERMS_AND_CONDITIONS, {
            reply_to_message_id: message_id,
          })
        } else if (text == '/plans') {
          await sendMessage(chatId, PRICING_PLANS_MESSAGE, {
            reply_to_message_id: message_id,
            reply_markup: {
              inline_keyboard: PRICING_PLANS.map(plan => {
                return [
                  {
                    text: plan.title,
                    callback_data: plan.title,
                  },
                ]
              }),
            },
          })
        } else {
          if (text.length < MIN_PROMPT_LENGTH) {
            await sendMessage(chatId, MIN_PROMPT_MESSAGE, {
              reply_to_message_id: message_id,
            })
            return
          } else if (text.length > MAX_PROMPT_LENGTH) {
            await sendMessage(chatId, MAX_PROMPT_MESSAGE, {
              reply_to_message_id: message_id,
            })
            return
          } else {
            await sendMessage(chatId, TEXT_GENERATION_MESSAGE, {
              reply_to_message_id: message_id,
              reply_markup: {
                inline_keyboard: TEXT_GENERATION_OPTIONS.map(e => {
                  return [
                    {
                      text: e.title,
                      callback_data: e.title,
                    },
                  ]
                }),
              },
            })
          }
        }
      } else if (message.document) {
        const { mime_type, file_id, file_size } = message.document

        if (!file_size) {
          await sendMessage(chatId, UNABLE_TO_PROCESS_DOCUMENT_MESSAGE, {
            reply_to_message_id: message_id,
          })
          return
        }

        // handle pdf files
        if (mime_type === 'application/pdf') {
          try {
            const sizeInMb = bytesToMegabytes(file_size)
            if (sizeInMb > TELEGRAM_FILE_SIZE_LIMIT) {
              await sendMessage(chatId, FILE_SIZE_EXCEEDED_MESSAGE, {
                reply_to_message_id: message_id,
              })
              return
            }
            await sendMessage(chatId, PROCESSING_BACKGROUND_MESSAGE, {
              reply_to_message_id: message_id,
            })

            const body: PdfBody = {
              chatId: chatId,
              messageId: message_id,
              fileId: file_id,
              userId,
            }

            const qStashPublishResponse = await qStash.publishJSON({
              url: `${process.env.QSTASH_URL}/embeddings` as string,
              body,
            })
            if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
              await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
                reply_to_message_id: message_id,
              })
            }
            console.log(`QStash Response: ${qStashPublishResponse.messageId}`)
          } catch (err) {
            console.error(err)
            await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: message_id,
            })
          }
        }

        // handle image files
        else if (mime_type === 'image/png' || mime_type === 'image/jpeg') {
          const sizeInMb = bytesToMegabytes(file_size)
          if (sizeInMb > TELEGRAM_IMAGE_SIZE_LIMIT) {
            await sendMessage(chatId, IMAGE_SIZE_EXCEEDED_MESSAGE, {
              reply_to_message_id: message_id,
            })
            return
          }

          await sendMessage(chatId, IMAGE_GENERATION_MESSAGE, {
            reply_to_message_id: message_id,
            reply_markup: {
              inline_keyboard: IMAGE_GENERATION_OPTIONS.map(e => {
                return [
                  {
                    text: e.title,
                    callback_data: e.title,
                  },
                ]
              }),
            },
          })
        } else {
          await sendMessage(chatId, INVALID_FILE_MESSAGE, {
            reply_to_message_id: message_id,
          })
        }
      } else if (message.voice) {
        const { voice } = message as any
        const { file_size } = voice
        const maxFileSizeInBytes = OPEN_AI_AUDIO_LIMIT * 1024 * 1024

        if (file_size > maxFileSizeInBytes) {
          await sendMessage(chatId, AUIDO_FILE_EXCEEDS_LIMIT_MESSAGE, {
            reply_to_message_id: message_id,
          })
          return
        }

        await sendMessage(chatId, TEXT_VOICE_MESSAGE, {
          reply_to_message_id: message_id,
          reply_markup: {
            inline_keyboard: TEXT_GENERATION_OPTIONS.filter(
              e => e.title != 'Goal' && e.title != 'Meme',
            ).map(e => {
              return [
                {
                  text: e.title,
                  callback_data: e.title,
                },
              ]
            }),
          },
        })
      } else if (message.photo) {
        // await set(`image:${userId}`,message.photo[message.photo.length - 1].file_id)
        await sendMessage(chatId, IMAGE_GENERATION_MESSAGE, {
          reply_to_message_id: message_id,
          reply_markup: {
            inline_keyboard: IMAGE_GENERATION_OPTIONS.map(e => {
              return [
                {
                  text: e.title,
                  callback_data: e.title,
                },
              ]
            }),
          },
        })
      } else if (message.successful_payment) {
        const userKey = `user:${userId}`
        const userImageLockResource = `locks:user:image:${from.id}`
        const userPdfLockResoruce = `locks:user:token:${from.id}`
        try {
          let unlockImage = await lock(userImageLockResource)
          let unlockPdf = await lock(userPdfLockResoruce)
          const {
            total_amount,
            currency,
            invoice_payload,
            telegram_payment_charge_id,
            provider_payment_charge_id,
          } = message.successful_payment
          const decimalAmount = total_amount / 100

          const purchased_image_generations =
            total_amount == 999 ? 10 : total_amount == 2499 ? 30 : 80
          const purchased_tokens =
            total_amount == 999
              ? 70000
              : total_amount == 2499
              ? 350000
              : 1500000

          try {
            const paymentCreationResult = await createNewPayment({
              user_id: from.id,
              amount: decimalAmount,
              currency,
              purchased_image_generations,
              purchased_tokens,
              provider_payment_charge_id,
              telegram_payment_charge_id,
              payment_method: 'Credit Card',
              payment_status: 'Paid',
            })

            if (!paymentCreationResult) {
              console.error('Payment unsuccessfully stored in db')
              console.error('Payment details: ', message.successful_payment)
              await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
                reply_to_message_id: message_id,
              })
              return
            }

            const userUpdateResult = await updateImageAndTokensTotal(
              from.id,
              purchased_image_generations,
              purchased_tokens,
            )

            if (!userUpdateResult) {
              console.error('User unsuccessfully updated in db')
              console.error('Payment details: ', message.successful_payment)
              await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
                reply_to_message_id: message_id,
              })
              return
            }

            const redisMulti = getRedisClient().multi() // Start a transaction
            redisMulti
              .hincrby(userKey, 'tokens', purchased_tokens)
              .hincrby(
                userKey,
                'image_generations_remaining',
                purchased_image_generations,
              )
            await redisMulti.exec() // Execute the transaction

            await sendMessage(
              chatId,
              `🚀 Welcome to the ${invoice_payload} on InsightAI! You've unlocked: 🚀

  🎨 Image Generations: ${purchased_image_generations} image generations to create captivating visuals and explore new possibilities.

  📚 Tokens for File Processing: ${purchased_tokens.toLocaleString()} tokens to help you process files and uncover greater insights.

  Learn more about your current limit at /limit. Thank you for choosing us, and we wish you a fantastic journey ahead! 😊🌟`,
              {
                reply_to_message_id: message_id,
              },
            )
          } catch (error) {
            console.error(error)
            console.error('Payment details: ', message.successful_payment)
            await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: message_id,
            })
          } finally {
            await unlockImage()
            await unlockPdf()
          }
        } catch (error) {
          console.error(error)
          console.error('Payment details: ', message.successful_payment)
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: message_id,
          })
        }
      } else {
        await sendMessage(chatId, INVALID_MESSAGE_TYPE_MESSAGE, {
          reply_to_message_id: message_id,
        })
      }
    }
    // deals with callback queries
    else if (update.callback_query) {
      const { callback_query } = update
      const {
        id,
        data,
        message,
        from: { id: userId },
      } = callback_query
      if (!message || !message.reply_to_message || !data) {
        return
      }

      const {
        text,
        voice,
        message_id: messageId,
        chat: { id: chatId },
      } = message.reply_to_message

      const rateLimitResult = await checkUserRateLimit(userId)
      // rate limit exceeded
      if (!rateLimitResult.result.success) {
        console.error('Rate limit exceeded')
        await sendMessage(
          message.chat.id,
          getEmbeddingsRateLimitResponse(
            rateLimitResult.hours,
            rateLimitResult.minutes,
          ),
        )
        return
      }

      if (
        data == 'Room' ||
        data == 'Restore' ||
        data == 'Scribble' ||
        data == 'Imagine' ||
        data == 'Blend'
      ) {
        if (userData.image_generations_remaining <= 0) {
          await sendMessage(chatId, INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE, {
            reply_to_message_id: messageId,
          })
          return
        }

        const rateLimitResult = await imageGenerationRateLimit(userId)

        if (!rateLimitResult.result.success) {
          console.error('Rate limit exceeded')
          await sendMessage(
            chatId,
            getEmbeddingsRateLimitResponse(
              rateLimitResult.hours,
              rateLimitResult.minutes,
              rateLimitResult.seconds,
            ),
            {
              reply_to_message_id: messageId,
            },
          )
          return
        }
      }

      // // check for rate limits for completions and and that the amount left is greater than 0
      if (
        data == 'General Question' ||
        data == 'PDF Question' ||
        data == 'Voice' ||
        data == 'Meme'
      ) {
        if (userData.tokens <= 0) {
          await sendMessage(chatId, INSUFFICIENT_TOKENS_MESSAGE, {
            reply_to_message_id: messageId,
          })
          return
        }

        const rateLimitResult = await checkCompletionsRateLimits(userId)

        if (!rateLimitResult.result.success) {
          console.error('Rate limit exceeded')
          await sendMessage(
            chatId,
            getEmbeddingsRateLimitResponse(
              rateLimitResult.hours,
              rateLimitResult.minutes,
              rateLimitResult.seconds,
            ),
            {
              reply_to_message_id: messageId,
            },
          )
          return
        }
      }

      if (
        data !== 'Basic Plan' &&
        data !== 'Pro Plan' &&
        data !== 'Business Plan' &&
        data !== 'Meme' &&
        data !== 'Yes' &&
        data !== 'No'
      ) {
        await sendMessage(message.chat.id, PROCESSING_BACKGROUND_MESSAGE, {
          reply_to_message_id: messageId,
        })
      }

      if (
        voice &&
        (data == 'General Question' ||
          data == 'PDF Question' ||
          data == 'Goal' ||
          data == 'Imagine' ||
          data == 'Ask Steve Jobs' ||
          data == 'Ask Ben Shapiro')
      ) {
        try {
          const body = {
            message: message.reply_to_message,
            userId,
            questionType: data,
          }

          const qStashPublishResponse = await qStash.publishJSON({
            url: `${process.env.QSTASH_URL}/voice` as string,
            body,
          })
          if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
            await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: messageId,
            })
          }
          console.log(`QStash Response: ${qStashPublishResponse.messageId}`)
        } catch (err) {
          console.error(err)
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
        }
      } else if (text && data == 'General Question') {
        const answer = await processGeneralQuestion(
          text,
          message?.reply_to_message,
          userId,
        )
        if (answer) {
          await sendMessage(chatId, answer, {
            reply_to_message_id: messageId,
          })
        } else {
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
        }
      } else if (text && data == 'Ask Steve Jobs') {
        await handleAudioRequest(
          userId,
          message?.reply_to_message,
          text,
          process.env.STEVE_JOBS_VOICE_ID as string,
        )
      } else if (text && data == 'Ask Ben Shapiro') {
        await handleAudioRequest(
          userId,
          message?.reply_to_message,
          text,
          process.env.BEN_SHAPIRO_VOICE_ID as string,
        )
      } else if (text && data == 'PDF Question') {
        await processPdfQuestion(text, message?.reply_to_message, userId)
      } else if (text && data == 'Goal') {
        const tasks = await startGoalAgent({ goal: text })

        if (tasks.length === 0) {
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
          return
        }

        const taskNames = []
        const redisTasks: any[] = [{ goal: text, nIterations: 0 }]

        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i]
          taskNames.push(`Task ${i + 1}: ${task}`)
          redisTasks.push({ task, completed: false })
        }

        const tasksMessage = `
        🎯 Goal: ${text}

📝 Here's what's in store for you:

${taskNames.join('\n')}

🏁 Ready to embark on this amazing adventure? 😃🙌
        `

        await set(`goal:${userId}`, JSON.stringify(redisTasks))

        await sendMessage(chatId, tasksMessage, {
          reply_to_message_id: messageId,
          reply_markup: {
            inline_keyboard: ['Yes', 'No'].map(option => {
              return [
                {
                  text: option,
                  callback_data: option,
                },
              ]
            }),
          },
        })
      } else if (text && data == 'Yes') {
        const goals = await safeGetObject(`goal:${userId}`, [])
        if (goals.length === 0) {
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
          return
        }
        const { goal, nIterations } = goals[0]
        const tasks = goals.slice(1) as Task[]

        if (nIterations > DEFAULT_MAX_LOOPS_FREE) {
          await del(`goal:${userId}`)
          await sendMessage(
            chatId,
            `You've exceeded the maximum number of loops for the free plan. Please upgrade to the Pro plan to continue using this feature`,
            {
              reply_to_message_id: messageId,
            },
          )
          return
        }

        const currentTask = tasks.find(task => !task.completed)
        if (!currentTask) {
          await del(`goal:${userId}`)
          await sendMessage(
            chatId,
            `🎉 Congratulations! You've completed your goal! 🎉`,
            {
              reply_to_message_id: messageId,
            },
          )
          return
        }

        const analysis = await analyzeTaskAgent(goal, currentTask.task)

        await sendMessage(
          chatId,
          `🏃‍♂️ Currently executing: 📝 Task ${currentTask.task}...`,
          {
            reply_to_message_id: messageId,
          },
        )

        await sendChatAction(chatId, 'typing')

        const result = await executeTaskAgent(
          goal,
          'English',
          currentTask.task,
          analysis,
        )

        if (!result) {
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
          return
        }

        await sendMessage(
          chatId,
          `
📝 Task: ${currentTask.task}

✅ Status: Completed! ${result}

👏 Great job! You're making excellent progress! Keep up the momentum! 🚀💫`,
          {
            reply_to_message_id: messageId,
          },
        )

        currentTask.completed = true
        try {
          const incompleteTasks = tasks.filter(task => !task.completed)
          const completedTasks = tasks.filter(task => task.completed)
          const data = {
            goal,
            language: 'English',
            tasks: incompleteTasks.map(task => task.task),
            lastTask: currentTask.task,
            result: result,
            completedTasks: completedTasks.map(task => task.task),
          }
          const newTasks = await createTasksAgent(data)
          if (newTasks.length === 0 && incompleteTasks.length === 0) {
            await sendMessage(
              chatId,
              `🎉 Congratulations! You've completed your goal! 🎉`,
              {
                reply_to_message_id: messageId,
              },
            )
            return
          }

          console.log(`newTasks: ${newTasks}`)
          const allTasks = [
            ...tasks,
            ...newTasks.map(task => {
              return { task, completed: false }
            }),
          ]
          console.log(`allTasks: ${allTasks}`)
          const redisTasks = [
            { goal, nIterations: nIterations + 1 },
            ...allTasks,
          ]
          let message = ''

          if (newTasks.length > 0) {
            message += `🔍 Exciting Discovery Alert! 🌟\n
🎯 During our research journey, we've uncovered some fantastic new tasks that could bring even more value to your exploration! 😃\n\n`
          }

          message += `📚 Here's the updated list of tasks:

${allTasks
  .map(
    (task, index) =>
      `${task.completed ? '✅' : '⏳'} Task ${index + 1}: ${task.task}`,
  )
  .join('\n')}

🔥 Would you like to dive deeper and unlock even more insights! 🚀🌠`

          await sendMessage(chatId, message, {
            reply_to_message_id: messageId,
            reply_markup: {
              inline_keyboard: ['Yes', 'No'].map(option => {
                return [
                  {
                    text: option,
                    callback_data: option,
                  },
                ]
              }),
            },
          })
          await set(`goal:${userId}`, JSON.stringify(redisTasks))
        } catch (err) {
          console.error(err)
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
        }
      } else if (text && data == 'No') {
        await del(`goal:${userId}`)
        await sendMessage(
          chatId,
          'No problem! You can always start a new goal just type your objective and select Goal option',
          {
            reply_to_message_id: messageId,
          },
        )
      } else if (text && data == 'Meme') {
        await sendMessage(chatId, MEMES_MESSAGE, {
          reply_to_message_id: messageId,
          reply_markup: {
            inline_keyboard: MEME_OPTIONS.map(meme => {
              return [
                {
                  text: meme.name,
                  callback_data: meme.name,
                },
              ]
            }),
          },
        })
      } else if (text && MEME_NAMES.includes(data as MemeType)) {
        await processMemeGeneration(
          text,
          data as MemeType,
          message?.reply_to_message,
          userId,
        )
      } else if (
        data == 'Room' ||
        data == 'Restore' ||
        data == 'Scribble' ||
        data == 'Imagine' ||
        data == 'Blend'
      ) {
        try {
          let body = {}
          if (data !== 'Imagine') {
            body = {
              message: message.reply_to_message,
              userId,
              conversionModel:
                data == 'Blend'
                  ? ConversionModel.MJ_BLEND
                  : data == 'Room'
                  ? ConversionModel.CONTROLNET_HOUGH
                  : data == 'Scribble'
                  ? ConversionModel.CONTROLNET_SCRIBBLE
                  : ConversionModel.GFPGAN,
            }
          } else {
            body = {
              message: message.reply_to_message,
              userId,
              conversionModel: ConversionModel.OPENJOURNEY,
              text,
            }
          }

          const qStashPublishResponse = await qStash.publishJSON({
            url: `${process.env.QSTASH_URL}/image` as string,
            body,
            retries: 0,
          })
          if (!qStashPublishResponse || !qStashPublishResponse.messageId) {
            await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
              reply_to_message_id: messageId,
            })
          }
          console.log(`QStash Response: ${qStashPublishResponse.messageId}`)
        } catch (err) {
          console.error(err)
          await sendMessage(chatId, INTERNAL_SERVER_ERROR_MESSAGE, {
            reply_to_message_id: messageId,
          })
        }
      } else if (
        data == 'Basic Plan' ||
        data == 'Pro Plan' ||
        data == 'Business Plan'
      ) {
        const plan = PRICING_PLANS.find(plan => plan.title == data)

        if (!plan) {
          await sendMessage(chatId, INVALID_PRICING_PLAN_MESSAGE, {
            reply_to_message_id: messageId,
          })
          return
        }

        const { title, description, price } = plan
        await sendInvoice(
          chatId,
          title,
          description,
          title,
          process.env.TELEGRAM_BOT_STRIPE_TOKEN as string,
          'usd',
          [{ label: plan.title, amount: plan.price * 100 }],
          {
            reply_to_message_id: messageId,
          },
        )
      } else {
        await sendMessage(chatId, INVALID_COMMAND_MESSAGE, {
          reply_to_message_id: messageId,
        })
      }
    } else if (update.pre_checkout_query) {
      const { id, total_amount, invoice_payload } = update.pre_checkout_query

      // check if product is valid
      const product = PRICING_PLANS.find(
        plan =>
          plan.title == invoice_payload && plan.price == total_amount / 100,
      )
      if (!product) {
        await answerPreCheckoutQuery(id, false, {
          error_message: INVALID_PRICING_PLAN_MESSAGE,
        })
        return
      }

      // TODO: log transcation details
      await answerPreCheckoutQuery(id, true)
    } else {
      // update that I am not currently supporting
      console.error(
        `Unsupported update type , update ${JSON.stringify(update)}`,
      )
      return
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      await handleUpdate(body)
      return new Response(
        JSON.stringify({
          status: 'ok',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      )
    } catch (error) {
      console.error(error)
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
          },
        },
      )
    }
  } else {
    return new Response(
      JSON.stringify({
        error: 'Method Not Allowed',
      }),
      {
        status: 405,
        headers: {
          'content-type': 'application/json',
        },
      },
    )
  }
}

export default tlg
