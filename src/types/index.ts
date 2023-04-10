import { SelectUser } from "@/lib/supabase";
import { Context } from "telegraf";


export type Document = {
    url: string;
    body: string;
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
    'controlnet-hough' = 'controlnet-hough',
    'controlnet-scribble' = 'controlnet-scribble',
    'gfpgan' = 'gfpgan',
    'openjourney' = 'openjourney',
}
