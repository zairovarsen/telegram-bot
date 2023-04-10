import { SelectUser } from "@/lib/supabase";
import { Context } from "telegraf";


export type Document = {
    url: string;
    body: string;
    hash: string;
}

export type Error = {
    url: string
    message: string
}

export interface CustomTelegramContext extends Context {
    userData: UserInfoCache;
}

export type UserInfoCache = Pick<SelectUser, 'tokens' | 'image_generations_remaining'>;

export enum ConversionModel {
    CONTROLNET_HOUGH = 'CONTROLNET_HOUGH',
    CONTROLNET_SCRIBBLE = 'CONTROLNET_SCRIBBLE',
    GFPGAN = 'GFPGAN',
    OPENJOURNEY = 'OPENJOURNEY',
}

export type ConversionModelAllButOpenJourney = Exclude<ConversionModel, ConversionModel.OPENJOURNEY>;