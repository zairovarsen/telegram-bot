import { CustomTelegramContext } from "@/types";
import { Telegraf } from "telegraf";


export const bot = new Telegraf<CustomTelegramContext>(
    process.env.NEXT_PUBLIC_TELEGRAM_TOKEN as string
  );