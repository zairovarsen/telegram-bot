

import { Redis } from '@upstash/redis';

const monthBin = (date: Date) => {
    return `${date.getFullYear()}/${date.getMonth() + 1}`;
}

let redis: Redis | null = null;

export const getUserEmbeddingsMonthTokenCountKey = (
    userId: number,
    date: Date
) => {
    return `${process.env.NODE_ENV}:user:${userId}:token_count:${monthBin(date)}`;
}

export const getRedisClient = () => {
    if (!redis) {
        redis = new Redis({
           url: process.env.UPSTASH_URL || '',
           token: process.env.UPSTASH_TOKEN || '', 
        })
    }
    return redis;
}

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
      await getRedisClient().set(key, value, {ex: expirationInSeconds});
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

export const hget = async (key: string, field: string): Promise<any | null> => {
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



const client = getRedisClient();

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRY_DELAY = 500;

async function acquireLock( lockName:string, timeout:number, retryDelay:number) {
  const lockTimeoutValue = Date.now() + timeout + 1;
  const result = await client.set(lockName, lockTimeoutValue, {
    px: timeout,
    nx: true,
  });
  if (result === null) {
    throw new Error("Lock failed");
  }
  return lockTimeoutValue;
}

async function releaseLock(lockName: string, lockTimeoutValue:number) {
  if (lockTimeoutValue > Date.now()) {
    await client.del(lockName);
  }
}

export function createRedisLock(retryDelay = DEFAULT_RETRY_DELAY) {
  
  async function lock(lockName:string, timeout = DEFAULT_TIMEOUT) {
    if (!lockName) {
      throw new Error(
        "You must specify a lock string. It is on the redis key `lock.[string]` that the lock is acquired."
      );
    }

    lockName = `lock.${lockName}`;

    while (true) {
      try {
        const lockTimeoutValue = await acquireLock(
          lockName,
          timeout,
          retryDelay
        );
        return () => releaseLock(lockName, lockTimeoutValue);
      } catch (err) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  return lock ;
}

export const lock = createRedisLock();