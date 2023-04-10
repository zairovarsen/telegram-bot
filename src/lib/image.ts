import { getRedisClient, hget, redlock } from "@/lib/redis";
import {
  IMAGE_GENERATION_ERROR_MESSAGE,
  INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
} from "@/utils/constants";
import { deleteImage, uploadImage } from "@/lib/cloudinary";
import { ConversionModel, ConversionModelAllButOpenJourney } from "@/types";
import {
  ReplicatePredictionResponse,
  generateGfpGan,
  generateOpenJourney,
  generateRoom,
  generateScribble,
  getImageStatus,
} from "@/lib/replicate";
import { backOff } from "exponential-backoff";
import { updateImageGenerationsRemaining } from "./supabase";

export type ImageGenerationResult = {
  success: true;
  imageGenerationsRemaining: number;
  fileUrl: string;
} | {
  success: false;
  errorMessage: string;
};

// The body of the request sent by QStash
export type ImageBody = {
  chatId: number;
  messageId: number;
  fileId: string;
  userId: number;
  conversionModel: ConversionModelAllButOpenJourney
} | {
  chatId: number;
  messageId: number;
  userId: number;
  conversionModel: ConversionModel.OPENJOURNEY; 
  prompt: string;
}

/**
 * Helper function to check if request body has a fileId
 * 
 * @param obj 
 * @returns 
 */
export const hasFileId = (obj: any): obj is {fileId: string} => {
  return 'fileId' in obj;
}

/**
 * Helper function to check if request body has a prompt
 * 
 * @param obj 
 * @returns 
 */
export const hasPrompt = (obj: any): obj is {prompt: string} => {
  return 'prompt' in obj;
}

/**
 * Parse the request body and return the appropriate type
 * 
 * @param body 
 * @returns 
 */
export const parseRequestBody = (body: any): ImageBody => {
  const { chatId, messageId, fileId, userId, conversionModel, prompt } = body;

  if (hasFileId(body) && hasPrompt(body)) {
    throw new Error('Invalid request body: both fileId and prompt properties are present');
  }

  if (hasFileId(body)) {
    return {
      chatId,
      messageId,
      fileId,
      userId,
      conversionModel
    };
  }

  if (hasPrompt(body)) {
    return {
      chatId,
      messageId,
      userId,
      conversionModel,
      prompt
    };
  }

  throw new Error('Invalid request body: neither fileId nor prompt property is present');
}

/**
 * Update the image generations remaining for the user in redis
 * 
 * @param userId 
 * @param imageGenerationRemaining 
 */
export const updateUserImageGenerationsRemainingRedis = async (
  userId: number,
  imageGenerationRemaining: number
): Promise<void> => {
  const userKey = `user:${userId}`;
  const redisMulti = getRedisClient().multi(); // Start a transaction
  redisMulti.hset(userKey, {
    image_generations_remaining: imageGenerationRemaining,
  });
  await redisMulti.exec(); // Execute the transaction
};

/**
 * Process an image prompt for the user and return the generated image
 * 
 * @param prompt 
 * @param userId 
 * @returns 
 */
export async function processImagePromptOpenJourney(
  prompt: string,
  userId: number,
): Promise<ImageGenerationResult> {
    // Acquire a lock on the user resource
  const userKey = `user:${userId}`;
  const userLockResource = `locks:user:image:${userId}`;
  try {
    let lock = await redlock.acquire([userLockResource], 5 * 60 * 1000);

    try {
      const imageGenerationsRemaining = parseInt(
        (await hget(userKey, "image_generations_remaining")) || "0"
      );

      // Check if the user has enough image generations remaining
      if (!imageGenerationsRemaining || imageGenerationsRemaining <= 0) {
        return {
          success: false,
          errorMessage: INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE,
        };
      }

      const generationResponse: ReplicatePredictionResponse = await generateOpenJourney(prompt);

      console.log(`Generation response: ${JSON.stringify(generationResponse)}`);

      if (!generationResponse.success) {
        return {
          success: false,
          errorMessage: generationResponse.errorMessage || IMAGE_GENERATION_ERROR_MESSAGE,
        };
      }

      console.log(`id is ${generationResponse.id}`);
      const id = generationResponse.id;
      let generatedImage = null;

      try {
        generatedImage = await backOff(() => getImageStatus(id), {
          startingDelay: 1000,
          numOfAttempts: 10,
        });
      } catch (e) {
        console.error(e);
      }

      console.log(`Generated image: ${generatedImage}`);

      if (!generatedImage || generatedImage.length < 10) {
        return {
          success: false,
          errorMessage: IMAGE_GENERATION_ERROR_MESSAGE,
        };
      }

      const updateUserImageGenerationRemainingDB =
        await updateImageGenerationsRemaining(
          userId,
          imageGenerationsRemaining - 1
        );
      if (!updateUserImageGenerationRemainingDB) {
        return {
          success: false,
          errorMessage: INTERNAL_SERVER_ERROR_MESSAGE,
        };
      }

      await updateUserImageGenerationsRemainingRedis(
        userId,
        imageGenerationsRemaining - 1
      );

      return {
        success: true,
        imageGenerationsRemaining: imageGenerationsRemaining - 1,
        fileUrl: generatedImage,
      };
    } catch (err) {
      console.error(err);
      return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
    } finally {
      // Release the lock when we're done
      await lock.release();
    }
  } catch (err) {
    // Failed to acquire lock
    console.error(err);
    return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
  } 
}

/**
 * Process a Image file, fetch from url, create a base64 string, upload to cloudinary, send to replicate api,
 * check status using backoff, get Image , update user image generation count, return Image to the user
 *
 * @param {string} imagePath - URL path to the image file
 * @param {number} userId - User ID
 * @param {ConversionModel} conversionModel - Conversion Model
 * @return {Promise<EmbeddingResult>} - EmbeddingResult
 */
export async function processImage(
  imagePath: string,
  userId: number,
  conversionModel: Omit<ConversionModel, "openjourney">
): Promise<ImageGenerationResult> {
  // Acquire a lock on the user resource
  const userKey = `user:${userId}`;
  const userLockResource = `locks:user:image:${userId}`;
  try {
    let lock = await redlock.acquire([userLockResource], 5 * 60 * 1000);
    // used to remove the image from cloudinary after some time
    let public_id = "";

    try {
      const imageGenerationsRemaining = parseInt(
        (await hget(userKey, "image_generations_remaining")) || "0"
      );

      // Check if the user has enough image generations remaining
      if (!imageGenerationsRemaining || imageGenerationsRemaining <= 0) {
        return {
          success: false,
          errorMessage: INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE,
        };
      }

      const response = await fetch(imagePath);
      const arrayBuffer = await response.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer as any, "binary").toString(
        "base64"
      );

      // #TODO: delete this image after some time
      const uploadResponse = await uploadImage(
        `data:image/jpeg;base64,${fileBuffer}`
      );

      if (!uploadResponse) {
        return {
          success: false,
          errorMessage: IMAGE_GENERATION_ERROR_MESSAGE,
        };
      }

      public_id = uploadResponse.public_id;
      const cloudinaryUrl = uploadResponse.secure_url;

      let generationResponse: ReplicatePredictionResponse = {} as any;

      if (conversionModel == ConversionModel.CONTROLNET_HOUGH) {
        generationResponse = await generateRoom(cloudinaryUrl);
      } else if (conversionModel == ConversionModel.CONTROLNET_SCRIBBLE) {
        generationResponse = await generateScribble(cloudinaryUrl);
      } else {
        generationResponse = await generateGfpGan(cloudinaryUrl);
      }

      console.log(`Generation response: ${JSON.stringify(generationResponse)}`);

      if (!generationResponse.success) {
        return {
          success: false,
          errorMessage: generationResponse.errorMessage || IMAGE_GENERATION_ERROR_MESSAGE,
        };
      }

      console.log(`id is ${generationResponse.id}`);
      const id = generationResponse.id;
      let generatedImage = null;

      try {
        generatedImage = await backOff(() => getImageStatus(id), {
          startingDelay: 1000,
          numOfAttempts: 10,
        });
      } catch (e) {
        console.error(e);
      }

      console.log(`Generated image: ${generatedImage}`);

      if (!generatedImage || generatedImage.length < 10) {
        return {
          success: false,
          errorMessage: IMAGE_GENERATION_ERROR_MESSAGE,
        };
      }

      const updateUserImageGenerationRemainingDB =
        await updateImageGenerationsRemaining(
          userId,
          imageGenerationsRemaining - 1
        );
      if (!updateUserImageGenerationRemainingDB) {
        return {
          success: false,
          errorMessage: INTERNAL_SERVER_ERROR_MESSAGE,
        };
      }

      await updateUserImageGenerationsRemainingRedis(
        userId,
        imageGenerationsRemaining - 1
      );

      return {
        success: true,
        imageGenerationsRemaining: imageGenerationsRemaining - 1,
        fileUrl: generatedImage,
      };
    } catch (err) {
      console.error(err);
      return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
    } finally {
      if (public_id) {
        await deleteImage(public_id);
      }
      // Release the lock when we're done
      await lock.release();
    }
  } catch (err) {
    // Failed to acquire lock
    console.error(err);
    return { success: false, errorMessage: INTERNAL_SERVER_ERROR_MESSAGE };
  }
}
