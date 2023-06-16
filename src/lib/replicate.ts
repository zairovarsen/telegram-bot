import { MidJourneyProxyTaskResponse } from '@/types'
import {
  IMAGE_GENERATION_ERROR_MESSAGE,
  ROOM_GENERATION_PROMPT,
  SCRIBBLE_GENERATION_PROMPT,
} from '@/utils/constants'
import { getErrorMessage } from '@/utils/handlers'

export type ReplicatePredictionResponse =
  | {
      success: true
      id: string
    }
  | {
      success: false
      errorMessage: string
    }

/* Replicate API call */
const makeRequest = async (
  url: string,
  data: { [key: string]: unknown },
): Promise<ReplicatePredictionResponse> => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Token ' + process.env.REPLICATE_API_KEY,
      },
      body: JSON.stringify(data),
    })

    if (response.status !== 201) {
      const error = await response.json()
      console.error(`Issue with replicate API call: ${error.detail}`)
      return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE}
    }

    const prediction = await response.json()
    return { success: true, id: prediction.id }
  } catch (err) {
    const message = getErrorMessage(err)
    console.error(err);
    return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE }
  }
}

/* Aesthetic Room Generation */
export const generateRoom = async (
  imageUrl: string,
): Promise<ReplicatePredictionResponse> => {
  const data = {
    version: '435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2de23e143fdb0117',
    input: {
      image: imageUrl,
      prompt: ROOM_GENERATION_PROMPT,
      scale: 9,
      a_prompt:
        'best quality, photo from Pinterest, interior, cinematic photo, ultra-detailed, ultra-realistic, award-winning, interior design, natural lighting',
      n_prompt:
        'longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
    },
  }
  return await makeRequest('https://api.replicate.com/v1/predictions', data)
}

/* Mid Journey like image */
export const generateOpenJourney = async (
  prompt: string,
): Promise<ReplicatePredictionResponse> => {
  const data = {
    version: '9936c2001faa2194a261c01381f90e65261879985476014a0a37a334593a05eb',
    input: {
      prompt: `mdjrny-v4 style ${prompt}`,
      guidance_scale: 7,
      num_inference_steps: 50,
      num_outputs: 1,
    },
  }
  return await makeRequest('https://api.replicate.com/v1/predictions', data)
}

/* Improve old image */
export const generateGfpGan = async (
  imageUrl: string,
): Promise<ReplicatePredictionResponse> => {
  const data = {
    version: '7de2ea26c616d5bf2245ad0d5e24f0ff9a6204578a5c876db53142edd9d2cd56',
    input: {
      image: imageUrl,
    },
  }
  return await makeRequest('https://api.replicate.com/v1/predictions', data)
}

/* Scribble Generation */
export const generateScribble = async (
  imageUrl: string,
): Promise<ReplicatePredictionResponse> => {
  const data = {
    version: '854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b',
    input: {
      image: imageUrl,
      prompt: SCRIBBLE_GENERATION_PROMPT,
      scale: 9,
      a_prompt: 'high-quality, intricately detailed image',
      n_prompt:
        'longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
    },
  }
  return await makeRequest('https://api.replicate.com/v1/predictions', data)
}

/* Check Image generation status */
export const getImageStatus = async (id: string): Promise<string> => {
  return await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Token ' + process.env.REPLICATE_API_KEY,
    },
  })
    .then(r => r.json())
    .then(finalResponse => {
      const jsonFinalResponse = finalResponse
      if (jsonFinalResponse.status === 'succeeded') {
        if (Array.isArray(jsonFinalResponse.output)) {
          if (jsonFinalResponse.output.length === 1) {
            return jsonFinalResponse.output[0] as string
          }
          return jsonFinalResponse.output[1] as string
        } else {
          return jsonFinalResponse.output as string
        }
      }
      throw new Error('Image generation failed')
    })
}

/* Blend 2 base 64 images */
export const generateBlendedImages = async (
  base64Array: string[]
): Promise<ReplicatePredictionResponse> => {
 
  const response = await fetch(`${process.env.MIDJOURNEY_RAILWAY_PROXY}/mj/submit/blend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'mj-api-secret': process.env.MIDJOURNEY_RAILWAY_PROXY_SECRET as string,
    },
    body: JSON.stringify({
      base64Array
    }),
  })
  if (response.status !== 200) {
    const error = await response.json()
    console.error(`Issue with midjourney API call: ${error.detail}`)
    return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE}
  }  

  const prediction = await response.json() 
  return { success: true, id: prediction.result }
}

/* Generate midjourney image using proxy */
export const generateMidjourneyImage = async (
  prompt: string,
): Promise<ReplicatePredictionResponse> => {
  const response = await fetch(`${process.env.MIDJOURNEY_RAILWAY_PROXY}/mj/submit/imagine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'mj-api-secret': process.env.MIDJOURNEY_RAILWAY_PROXY_SECRET as string,
    },
    body: JSON.stringify({
      prompt
    }),
  })

  if (response.status !== 200) {
    const error = await response.json()
    console.error(`Issue with midjourney API call: ${error.detail}`)
    return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE}
  }  

  const prediction = await response.json() 
  return { success: true, id: prediction.result }
}

/* Check proxy task of midjournmey image generation */
export const getMidjourneyImage = async (id: string): Promise<string> => { 
  return await fetch(`${process.env.MIDJOURNEY_RAILWAY_PROXY}/mj/task/${id}/fetch`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'mj-api-secret': process.env.MIDJOURNEY_RAILWAY_PROXY_SECRET as string,
    },
  })
    .then(r => r.json())
    .then(finalResponse => {
      const jsonFinalResponse = finalResponse as MidJourneyProxyTaskResponse;
      const status = jsonFinalResponse.status;
      if (status == 'SUCCESS') {
         return jsonFinalResponse.imageUrl 
      } else {
        throw new Error('Image generation failed')
      } 
    })
}