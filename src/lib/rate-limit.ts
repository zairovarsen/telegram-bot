import { pluralize } from "@/utils/pluralize";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedisUpstashClient } from "./redis";

enum RateLimitTypes {
  PDF = "pdf",
  IMAGE = "image",
  REQUESTS = "requests",
  COMPLETION = "completion",
}

const rateLimitTypeToKey = (type: RateLimitTypes, userId: number) => {
  return `${type}:${userId}`;
};

// const rateLimitTypeToKey = (type: 'pdf' | 'url' | 'completion', userId: number) => {
//   return `${type}:${userId}`;
// }

// // export const checkIpRateLimit = async (ip: string) => {
// //   const ratelimit = new Ratelimit({
// //     redis: getRedisClient(),
// //     limiter: Ratelimit.fixedWindow(100, "1 m"),
// //     analytics: true,
// //   });

// //   const result = await ratelimit.limit(`${ip}`);

// //   // Calcualte the remaining time until generations are reset
// //   const diff = Math.abs(
// //     new Date(result.reset).getTime() - new Date().getTime()
// //   );
// //   const hours = Math.floor(diff / 1000 / 60 / 60);
// //   const minutes = Math.floor(diff / 1000 / 60) - hours * 60;
// //   const seconds = Math.floor(diff / 1000) - hours * 60 * 60 - minutes * 60;

// //   return { result, hours, minutes, seconds };
// // }

export const checkCompletionsRateLimits = async (userId: number) => {
  // For now, impose a hard limit of 10 completions per day
  // per user. Later, tie it to the plan associated to a team/project.
  const ratelimit = new Ratelimit({
    redis: getRedisUpstashClient(),
    limiter: Ratelimit.fixedWindow(10, "24 h"),
    analytics: true,
  });

  const result = await ratelimit.limit(rateLimitTypeToKey(RateLimitTypes.COMPLETION, userId));

  // Calcualte the remaining time until generations are reset
  const diff = Math.abs(
    new Date(result.reset).getTime() - new Date().getTime()
  );
  const hours = Math.floor(diff / 1000 / 60 / 60);
  const minutes = Math.floor(diff / 1000 / 60) - hours * 60;
  const seconds = Math.floor(diff / 1000) - hours * 60 * 60 - minutes * 60;

  return { result, hours, minutes, seconds };
};

// export const checkEmbeddingsRateLimit = async (type: 'pdf' | 'url',userId: number) => {
//   // For now, impose a hard limit of 1 pdf file and 1 url processing per 24 hours
//   // per user. Later, tie it to the plan associated to a team/project.
//   const ratelimit = new Ratelimit({
//     redis: getRedisClient(),
//     limiter: Ratelimit.fixedWindow(10, "1 m"),
//     analytics: true,
//   });

//   const result = await ratelimit.limit(rateLimitTypeToKey(type, userId));

//   // Calcualte the remaining time until generations are reset
//   const diff = Math.abs(
//     new Date(result.reset).getTime() - new Date().getTime()
//   );
//   const hours = Math.floor(diff / 1000 / 60 / 60);
//   const minutes = Math.floor(diff / 1000 / 60) - hours * 60;

//   return { result, hours, minutes };
// };

/**
 * Check the rate limit for a user, 10 requests per minute
 *
 * @param userId
 * @returns {result: RateLimitResponse, hours: number, minutes: number, seconds: number}
 */
export const checkUserRateLimit = async (userId: number) => {
  const ratelimit = new Ratelimit({
    redis: getRedisUpstashClient(),
    limiter: Ratelimit.fixedWindow(10, "1 m"),
    analytics: true,
  });

  const result = await ratelimit.limit(
    rateLimitTypeToKey(RateLimitTypes.REQUESTS, userId)
  );

  // Calcualte the remaining time until generations are reset
  const diff = Math.abs(
    new Date(result.reset).getTime() - new Date().getTime()
  );
  const hours = Math.floor(diff / 1000 / 60 / 60);
  const minutes = Math.floor(diff / 1000 / 60) - hours * 60;
  const seconds = Math.floor(diff / 1000) - hours * 60 * 60 - minutes * 60;

  return { result, hours, minutes, seconds };
};

export const imageGenerationRateLimit = async (userId: number) => {
  const rateLimit = new Ratelimit({
    redis: getRedisUpstashClient(),
    limiter: Ratelimit.fixedWindow(1, "1 m"),
    analytics: true,
  });

  const result = await rateLimit.limit(
    rateLimitTypeToKey(RateLimitTypes.IMAGE, userId)
  );
  // Calcualte the remaining time until generations are reset
  const diff = Math.abs(
    new Date(result.reset).getTime() - new Date().getTime()
  );

  const hours = Math.floor(diff / 1000 / 60 / 60);
  const minutes = Math.floor(diff / 1000 / 60) - hours * 60;
  const seconds = Math.floor(diff / 1000) - hours * 60 * 60 - minutes * 60;

  return { result, hours, minutes, seconds };
};

export const getEmbeddingsRateLimitResponse = (
  hours: number,
  minutes: number,
  seconds?: number
) => {
  return `⚠️ Rate Limit Exceeded ⚠️

It seems you've exceeded the maximum number of requests allowed. Please try again in ${
    hours ? `${pluralize(hours, "hour", "hours")} and ` : ""
  }${
    minutes ? `${pluralize(minutes, "minute", "minutes")} and ` : ""
  }${pluralize(
    seconds || 0,
    "second",
    "seconds"
  )}. If you have any questions or need assistance, feel free to reach out at email: ${
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "us"
  } if you have any questions. We're here to help! 😊.`;
};
