import { Client } from "@upstash/qstash";
import { Receiver } from "@upstash/qstash";


export const qStash = new Client({
    token: process.env.QSTASH_TOKEN as string
})



export const qReceiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY as string,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY as string,
});

