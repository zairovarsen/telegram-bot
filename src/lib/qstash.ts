import { Client } from "@upstash/qstash";


export const qStash = new Client({
    token: process.env.QSTASH_TOKEN as string
})
