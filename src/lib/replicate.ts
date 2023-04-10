import {
  IMAGE_GENERATION_ERROR_MESSAGE,
  ROOM_GENERATION_PROMPT,
  SCRIBBLE_GENERATION_PROMPT,
} from "@/utils/constants";

export type ReplicatePredictionResponse = {
  success: true;
  id: string;
} | {
  success: false;
  errorMessage: string;
};

export const generateRoom = async (
  imageUrl: string
): Promise<ReplicatePredictionResponse> => {
  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token " + process.env.REPLICATE_API_KEY,
      },
      body: JSON.stringify({
        version:
          "435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2de23e143fdb0117",
        input: {
          image: imageUrl,
          prompt: ROOM_GENERATION_PROMPT,
          scale: 9,
          a_prompt:
            "best quality, photo from Pinterest, interior, cinematic photo, ultra-detailed, ultra-realistic, award-winning, interior design, natural lighting",
          n_prompt:
            "longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality",
        },
      }),
    });

    if (response.status !== 201) {
      const error = await response.json();
      console.error(
        `Error for Internal Purpose. Issue with replicate API call: ${error.detail}`
      );
      return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
    }

    const prediction = await response.json();
    return { success: true, id: prediction.id };
  } catch (err) {
    console.log(err);
    return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
  }
};

export const generateOpenJourney = async (
  prompt: string
): Promise<ReplicatePredictionResponse> => {
  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token " + process.env.REPLICATE_API_KEY,
      },
      body: JSON.stringify({
        version:
          "9936c2001faa2194a261c01381f90e65261879985476014a0a37a334593a05eb",
        input: {
          prompt: `mdjrny-v4 style ${prompt}`,
          guidance_scale: 7,
          num_inference_steps: 50,
          num_outputs: 1
        },
      }),
    });

    if (response.status !== 201) {
      const error = await response.json();
      console.error(
        `Error for Internal Purpose. Issue with replicate API call: ${error.detail}`
      );
      return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
    }

    const prediction = await response.json();
    return { success: true, id: prediction.id };
  } catch (err) {
    console.log(err);
    return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
  }
};

export const generateGfpGan = async (
  imageUrl: string
): Promise<ReplicatePredictionResponse> => {
  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token " + process.env.REPLICATE_API_KEY,
      },
      body: JSON.stringify({
        version:
          "7de2ea26c616d5bf2245ad0d5e24f0ff9a6204578a5c876db53142edd9d2cd56",
        input: {
          image: imageUrl,
        },
      }),
    });

    if (response.status !== 201) {
      const error = await response.json();
      console.error(
        `Error for Internal Purpose. Issue with replicate API call: ${error.detail}`
      );
      return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
    }

    const prediction = await response.json();
    return { success: true, id: prediction.id };
  } catch (err) {
    console.log(err);
    return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
  }
};

export const generateScribble = async (imageUrl: string): Promise<any> => {
  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token " + process.env.REPLICATE_API_KEY,
      },
      body: JSON.stringify({
        version:
          "854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b",
        input: {
          image: imageUrl,
          prompt: SCRIBBLE_GENERATION_PROMPT,
          scale: 9,
          a_prompt: "high-quality, intricately detailed image",
          n_prompt:
            "longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality",
        },
      }),
    });

    if (response.status !== 201) {
      const error = await response.json();
      console.error(
        `Error for Internal Purpose. Issue with replicate API call: ${error.detail}`
      );
      return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
    }

    const prediction = await response.json();
    return { success: true, id: prediction.id };
  } catch (err) {
    console.log(err);
    return { success: false, errorMessage: IMAGE_GENERATION_ERROR_MESSAGE };
  }
};

export const getImageStatus = async (id: string): Promise<string> => {
  return await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Token " + process.env.REPLICATE_API_KEY,
    },
  })
    .then((r) => r.json())
    .then((finalResponse) => {
      const jsonFinalResponse = finalResponse;
      console.log(jsonFinalResponse);
      if (jsonFinalResponse.status === "succeeded") {
        if (Array.isArray(jsonFinalResponse.output)) {
          if (jsonFinalResponse.output.length === 1) {
            return jsonFinalResponse.output[0] as string;
          }
          return jsonFinalResponse.output[1] as string;
        } else {
          return jsonFinalResponse.output as string;
        }
      }
      throw new Error("Image generation failed");
    });
};
