

import Redis from "ioredis";
import Redlock, { ResourceLockedError } from "redlock";
import { Redis as UpstashRedis } from '@upstash/redis';



const monthBin = (date: Date) => {
    return `${date.getFullYear()}/${date.getMonth() + 1}`;
}

let redis: Redis | null = null;
let upstashRedis: UpstashRedis | null = null;

export const getUserEmbeddingsMonthTokenCountKey = (
    userId: number,
    date: Date
) => {
    return `${process.env.NODE_ENV}:user:${userId}:token_count:${monthBin(date)}`;
}

export const getRedisClient = () => {
    if (!redis) {
        redis = new Redis(process.env.IOREDIS_URL as string)
    }
    return redis;
}

export const getRedisUpstashClient = () => {
  if (!upstashRedis) {
    upstashRedis = new UpstashRedis({
      url: process.env.UPSTASH_URL || '',
      token: process.env.UPSTASH_TOKEN || '',
    });
  }
  return upstashRedis;
}

export const redlock = new Redlock([getRedisClient()], {   retryCount: 10,
  retryDelay: 3000,   retryJitter: 200});

redlock.on("error", (error) => {
  // Ignore cases where a resource is explicitly marked as locked on a client.
  if (error instanceof ResourceLockedError) {
    return;
  }

  // Log all other errors.
  console.error(error);
});

export const get = async (key: string): Promise<string | null> => {
    try {
        return getRedisClient().get(key);
    } catch (e) {
        console.error('Redis get error', e);
    }
    return null;
}

export const setWithExpiration = async (
    key: string,
    value: string,
    expirationInSeconds: number,
  ) => {
    try {
      await getRedisClient().set(key, value, 'EX', expirationInSeconds);
    } catch (e) {
      console.error('Redis `set` error', e);
    }
  };

export const set = async (key: string, value: string): Promise<void> => {
    try {
        await getRedisClient().set(key, value);
    } catch (e) {
        console.error('Redis set error', e, key, value);
    }
};


export const safeGetObject = async <T>(key: string, defaultValue: T): Promise<T> => {
    const value = await get(key) as T;
    if (value) {
        return value;
    }
    return defaultValue;
}

export const hgetAll = async (key: string) => {
    try {
        return await getRedisClient().hgetall(key);
    } catch (e) {
        console.error('Redis `hgetall` error', e);
    }
    return null;
}

export const hget = async (key: string, field: string): Promise<string | null> => {
    try {
      return await getRedisClient().hget(key, field);
    } catch (e) {
      console.error('Redis `hget` error', e);
    }
    return null;
  };

  export const hmset = async (key: string, fields: Record<string, any>) => {
    try {
      await getRedisClient().hmset(key, fields);
    } catch (e) {
      console.error('Redis `hmset` error', e);
    }
  }
  
  export const hset = async (key: string, field: string, newValue: string) => {
    try {
      await getRedisClient().hset(key, {[field]: newValue});
    } catch (e) {
      console.error('Redis `hset` error', e);
    }
  };




  export const hincrby = async (key: string, field: string, increment: number) => {
    try {
        await getRedisClient().hincrby(key, field, increment);
    } catch (e) {   
        console.error('Redis `hincrby` error', e);
    }
  }

  export const del = async (key: string) => {
    try {
      await getRedisClient().del(key);
    } catch (e) {
      console.error('Redis `del` error', e);
    }
  };