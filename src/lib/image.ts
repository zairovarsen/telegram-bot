import { getRedisClient, hget, lock } from '@/lib/redis'
import {
  IMAGE_GENERATION_ERROR_MESSAGE,
  INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
} from '@/utils/constants'
import { deleteImage, uploadImage } from '@/lib/cloudinary'
import {
  ConversionModel,
  ConversionModelAllButOpenJourney,
  TelegramBot,
} from '@/types'
import {
  ReplicatePredictionResponse,
  generateGfpGan,
  generateOpenJourney,
  generateRoom,
  generateScribble,
  getImageStatus,
} from '@/lib/replicate'
import { backOff } from 'exponential-backoff'
import { updateImageGenerationsRemaining } from './supabase'
import { getFile } from '@/lib/bot'
import { getErrorMessage } from '@/utils/handlers'

export type ImageGenerationResult =
  | {
      success: true
      imageGenerationsRemaining: number
      fileUrl: string
    }
  | {
      success: false
      errorMessage: string
    }

// The body of the request sent by QStash
export type ImageBody =
  | {
      message: TelegramBot.Message
      userId: number
      conversionModel: ConversionModelAllButOpenJourney
    }
  | {
      message: TelegramBot.Message
      userId: number
      conversionModel: ConversionModel.OPENJOURNEY
      text: string
    }

/**
 * Helper function to check if request body has a fileId
 *
 * @param obj
 * @returns
 */
export const hasFileId = (obj: any): obj is { fileId: string } => {
  return typeof obj === 'object' && obj !== null && 'fileId' in obj
}

/**
 * Helper function to check if request body has a prompt
 *
 * @param obj
 * @returns
 */
export const hasPrompt = (obj: any): obj is { prompt: string } => {
  return typeof obj === 'object' && obj !== null && 'prompt' in obj
}

async function updateGenerationsCount(
  userId: number,
  imageGenerationsRemaining: number,
) {
  const updateUserImageGenerationRemainingDB =
    await updateImageGenerationsRemaining(userId, imageGenerationsRemaining - 1)
  if (!updateUserImageGenerationRemainingDB) {
    throw new Error(INTERNAL_SERVER_ERROR_MESSAGE)
  }

  await updateUserImageGenerationsRemainingRedis(
    userId,
    imageGenerationsRemaining - 1,
  )
}

/**
 * Update the image generations remaining for the user in redis
 *
 * @param userId
 * @param imageGenerationRemaining
 */
export const updateUserImageGenerationsRemainingRedis = async (
  userId: number,
  imageGenerationRemaining: number,
): Promise<void> => {
  const userKey = `user:${userId}`
  const redisMulti = getRedisClient().multi() // Start a transaction
  redisMulti.hset(userKey, {
    image_generations_remaining:
      imageGenerationRemaining > 0 ? imageGenerationRemaining : 0,
  })
  await redisMulti.exec() // Execute the transaction
}

// A separate function for getting and updating image generations count
async function getImageGenerationsCount(userId: number) {
  const userKey = `user:${userId}`
  const imageGenerationsRemaining = parseInt(
    (await hget(userKey, 'image_generations_remaining')) || '0',
  )
  if (!imageGenerationsRemaining || imageGenerationsRemaining <= 0) {
    throw new Error(INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE)
  }
  return imageGenerationsRemaining
}

/**
 * Process an image prompt for the user and return the generated image
 */
export async function processImagePromptOpenJourney(
  prompt: string,
  userId: number,
): Promise<ImageGenerationResult> {
  // Acquire a lock on the user resource
  const userLockResource = `locks:user:image:${userId}`
  try {
    const unlock = await lock(userLockResource)

    try {
      const imageGenerationsRemaining = await getImageGenerationsCount(userId)

      const generationResponse: ReplicatePredictionResponse =
        await generateOpenJourney(prompt)

      if (!generationResponse.success) {
        throw new Error(generationResponse.errorMessage || IMAGE_GENERATION_ERROR_MESSAGE)
      }

      const id = generationResponse.id
      let generatedImage = null

      try {
        generatedImage = await backOff(() => getImageStatus(id), {
          startingDelay: 1000,
          numOfAttempts: 10,
        })
      } catch (e) {
        console.error(e)
      }

      if (!generatedImage || generatedImage.length < 10) {
        throw new Error(IMAGE_GENERATION_ERROR_MESSAGE);
      }

      // Update the image generations remaining for the user
      await updateGenerationsCount(userId, imageGenerationsRemaining-1)

      return {
        success: true,
        imageGenerationsRemaining: imageGenerationsRemaining - 1,
        fileUrl: generatedImage,
      }
    } catch (err) {
      console.error(err)
      const errorMessage = getErrorMessage(err)
      return {
        success: false,
        errorMessage: errorMessage || INTERNAL_SERVER_ERROR_MESSAGE,
      }
    } finally {
      // Release the lock when we're done
      await unlock()
    }
  } catch (err) {
    console.error(err)
    const errorMessage = getErrorMessage(err)
    return {
      success: false,
      errorMessage: errorMessage || INTERNAL_SERVER_ERROR_MESSAGE,
    }
  }
}

function getFileIdFromMessage(message: TelegramBot.Message): string {
  if (message.document) {
    return message.document.file_id
  } else if (message.photo) {
    return message.photo[message.photo.length - 1].file_id
  } else {
    return ''
  }
}

async function fetchAndUploadFile(fileId: string): Promise<{public_id: string, cloudinaryUrl: string}> {
  const file = await getFile(fileId)
  const imagePath = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`
  const response = await fetch(imagePath)
  const arrayBuffer = await response.arrayBuffer()
  const fileBuffer = Buffer.from(arrayBuffer as any, 'binary').toString(
    'base64',
  )

  // #TODO: delete this image after some time
  const uploadResponse = await uploadImage(
    `data:image/jpeg;base64,${fileBuffer}`,
  )

  if (!uploadResponse) {
    throw new Error(IMAGE_GENERATION_ERROR_MESSAGE)
  }

  const public_id = uploadResponse.public_id
  const cloudinaryUrl = uploadResponse.secure_url
  return {public_id, cloudinaryUrl}
} 

/**
 * Process a Image file, fetch from url, create a base64 string, upload to cloudinary, send to replicate api,
 * check status using backoff, get Image , update user image generation count, return Image to the user
 */
export async function processImage(
  message: TelegramBot.Message,
  userId: number,
  conversionModel: Omit<ConversionModel, 'openjourney'>,
): Promise<ImageGenerationResult> {

  // Acquire a lock on the user resource
  const userLockResource = `locks:user:image:${userId}`

  // Get the file id from the message
  let file_id = getFileIdFromMessage(message)
  
  if (!file_id) {
    return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE }
  }

  try {
    let unlock = await lock(userLockResource)
    // used to remove the image from cloudinary after some time
    let public_id = ''

    try {
      const imageGenerationsRemaining = await getImageGenerationsCount(userId);

      const fileUpload = await fetchAndUploadFile(file_id)

      public_id = fileUpload.public_id
      const cloudinaryUrl = fileUpload.cloudinaryUrl

      let generationResponse: ReplicatePredictionResponse = {} as any

      if (conversionModel == ConversionModel.CONTROLNET_HOUGH) {
        generationResponse = await generateRoom(cloudinaryUrl)
      } else if (conversionModel == ConversionModel.CONTROLNET_SCRIBBLE) {
        generationResponse = await generateScribble(cloudinaryUrl)
      } else {
        generationResponse = await generateGfpGan(cloudinaryUrl)
      }

      if (!generationResponse.success) {
        return {
          success: false,
          errorMessage:
            generationResponse.errorMessage || IMAGE_GENERATION_ERROR_MESSAGE,
        }
      }

      const id = generationResponse.id
      let generatedImage = null

      try {
        generatedImage = await backOff(() => getImageStatus(id), {
          startingDelay: 1000,
          numOfAttempts: 10,
        })
      } catch (e) {
        console.error(e)
      }

      console.log(`Generated image: ${generatedImage}`)

      if (!generatedImage || generatedImage.length < 10) {
        return {
          success: false,
          errorMessage: IMAGE_GENERATION_ERROR_MESSAGE,
        }
      }

      // Update the image generations remaining for the user
      await updateGenerationsCount(userId, imageGenerationsRemaining-1)

      return {
        success: true,
        imageGenerationsRemaining: imageGenerationsRemaining - 1,
        fileUrl: generatedImage,
      }
    } catch (err) {
      console.error(err)
      return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE }
    } finally {
      if (public_id) {
        await deleteImage(public_id)
      }
      // Release the lock when we're done
      await unlock()
    }
  } catch (err) {
    // Failed to acquire lock
    console.error(err)
    return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE }
  }
}
