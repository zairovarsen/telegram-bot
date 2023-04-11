import { Database } from "@/types/supabase";

import {  createClient } from "@supabase/supabase-js";

interface Client {
  url?: string;
  key?: string;
}

const client: Client = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY,
};

if (!client.url || !client.key) {
  throw new Error("Missing Supabase credentials");
}

export const supabaseClient = createClient<Database>(client.url!, client.key!);

export type InsertPayment = Database["public"]["Tables"]["payments"]["Insert"];
export type SelectPayment = Database["public"]["Tables"]["payments"]["Row"];

export type InsertUser = Database["public"]["Tables"]["users"]["Insert"];
export type SelectUser = Database["public"]["Tables"]["users"]["Row"];

export type InsertDocuments =
  Database["public"]["Tables"]["documents"]["Insert"];
export type SelectDocuments = Database["public"]["Tables"]["documents"]["Row"];


export type MatchDocumentsReturn =
  Database["public"]["Functions"]["match_documents"]["Returns"];

export type DistinctUrls = Database["public"]["Views"]["distinct_user_file_url"]["Row"]["url"];

/**
 * Get user data from the database

 * @param user_id
 * @returns SelectUser | null
 */
export const getUserDataFromDatabase = async (
  user_id: number
): Promise<SelectUser | null> => {
  try {
    const { data, error } = await supabaseClient
      .from("users")
      .select("*")
      .eq("user_id", user_id);

    if (error) {
      console.error(`Error while getting user data: ${error}`);
      return null;
    } else {
      return data[0];
    }
  } catch (error) {
    console.error(`Exception occurred while getting user data: ${error}`);
    return null;
  }
};

/**
 * Get user file hashes
 */
export const checkUserFileHashExist = async (
  user_id: number,
  hash: string
): Promise<boolean> => {
  try {
    const { data, error } = await supabaseClient
      .from("distinct_user_file_hashes")
      .select("*")
      .eq("user_id", user_id)
      .eq("hash", hash)
      .limit(1);

    if (error) {
      console.error(`Error while checking file hash: ${error}`);
      return false;
    } else {
      return data.length > 0;
    }
  } catch (error) {
    console.error(`Exception occurred while checking file hash: ${error}`);
    return false;
  }
};

/** Create new user in the database
 *
 * @param body
 * @returns boolean | null
 */
export const createNewUser = async (
  body: InsertUser
): Promise<SelectUser | null> => {
  try {
    const { data, error } = await supabaseClient
      .from("users")
      .insert([body])
      .select();

    if (error) {
      console.error(`Error while creating new user: ${error}`);
      return null;
    } else {
      return data[0];
    }
  } catch (err) {
    console.error(`Exception occurred while creating new user: ${err}`);
    return null;
  }
};

export const updateImageAndTokensTotal = async (
  user_id: number,
  image_generations_added: number,
  tokens_added: number
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient.rpc("increment_two_fields", {
      x1: image_generations_added,
      x2: image_generations_added,
      x3: tokens_added,
      row_id: user_id,
    });
    if (error) {
      console.error(
        `Error while updating user image generations remaining and tokens: ${error}`
      );
      return false;
    } else {
      return true;
    }
  } catch (e) {
    console.error(
      `Exception occurred while updating user image generations remaining and tokens: ${e}`
    );
    return false;
  }
};

/**
 * Update user image generations remaining in the database
 *
 * @param user_id
 * @param tokens
 * @returns
 */
export const updateImageGenerationsRemaining = async (
  user_id: number,
  image_generations_remaining: number
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient
      .from("users")
      .update({ image_generations_remaining })
      .eq("user_id", user_id);

    if (error) {
      console.error(
        `Error while updating user image generations remaining: ${error}`
      );
      return false;
    } else {
      return true;
    }
  } catch (err) {
    console.error(
      `Exception occurred while updating user image generations remaining: ${err}`
    );
    return false;
  }
};

/**
 * Update user token count in the database
 *
 * @param user_id
 * @param tokens
 * @returns
 */
export const updateUserTokens = async (
  user_id: number,
  tokens: number
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient
      .from("users")
      .update({ tokens })
      .eq("user_id", user_id);

    if (error) {
      console.error(`Error while updating user token count: ${error}`);
      return false;
    } else {
      return true;
    }
  } catch (err) {
    console.error(`Exception occurred while updating user token count: ${err}`);
    return false;
  }
};

/** Create new documents in the database in batch
 *
 * @param body
 * @returns boolean
 */
export const createDocumentsBatch = async (
  body: InsertDocuments[]
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient.from("documents").insert(body);
    if (error) {
      console.error(`Error while creating documents batch: ${error}`);
      return false;
    } else {
      return true;
    }
  } catch (err) {
    console.error(`Exception occurred while creating documents batch: ${err}`);
    return false;
  }
};

/** Create new documents in the database in single
 *
 * @param body
 * @returns boolean
 */
export const createDocumentsSingle = async (
  body: InsertDocuments
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient.from("documents").insert([body]);
    if (error) {
      console.error(`Error while creating documents single: ${error}`);
      return false;
    } else {
      return true;
    }
  } catch (err) {
    console.error(`Exception occurred while creating documents: ${err}`);
    return false;
  }
};

/**
 * Creta new payment in the database
 *
 * @param PaymentDTO
 * @returns PaymentResponse | null
 */
export const createNewPayment = async ({
  user_id,
  amount,
  currency,
  purchased_image_generations,
  purchased_tokens,
  provider_payment_charge_id,
  telegram_payment_charge_id,
  payment_method,
  payment_status,
}: InsertPayment): Promise<boolean> => {
  try {
    const newPayment = {
      user_id,
      amount,
      currency,
      purchased_image_generations,
      purchased_tokens,
      provider_payment_charge_id,
      telegram_payment_charge_id,
      payment_method,
      payment_status,
    };

    const { data, error } = await supabaseClient
      .from("payments")
      .insert([newPayment]);

    if (error) {
      console.error(`Error while adding new payment: ${error}`);
      return false;
    } else {
      return true;
    }
  } catch (err) {
    console.error(`Exception occurred while adding new payment: ${err}`);
    return false;
  }
};

/**
 * Upload file to Supabase storage
 * @param file
 * @returns string | null
 */
export const uploadFileToSupabaseStorage = async (
  file: Buffer
): Promise<string | null> => {
  try {
    const bucketName = "user-files";
    const fileName = `pdf/${Date.now()}.pdf`;

    const { error } = await supabaseClient.storage
      .from(bucketName)
      .upload(fileName, file, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (error) {
      console.error(
        `Error while uploading file to Supabase storage: ${error.message}`
      );
      return null;
    } else {
      return `https://osvtgvfbqnfwkwhrdmek.supabase.co/storage/v1/object/public/user-files/${fileName}`;
    }
  } catch (err) {
    console.error(
      `Exception occurred while uploading file to Supabase storage: ${err}`
    );
    return null;
  }
};

/**
 * Match supabase document embeddings with the given embeddings cosine similarity
 */
export const matchDocuments = async (
  embeddings: unknown
): Promise<MatchDocumentsReturn | null> => {
  try {
    const { data: documents, error } = await supabaseClient.rpc(
      "match_documents",
      {
        query_embedding: embeddings as string,
        similarity_threshold: 0.1,
        match_count: 10,
      }
    );
    if (error) {
      console.error(`Error while matching documents: ${JSON.stringify(error)}`);
      return null;
    }
    if (!documents || documents.length === 0) {
      console.error(`No documents found`);
      return null;
    }
    return documents;
  } catch (err) {
    console.error(`Exception occurred while matching documents: ${err}`);
    return null;
  }
};


export const getUserDistinctUrls = async (
  user_id: number
): Promise<DistinctUrls[] | null> => {
  try {
    const { data: urls, error } = await supabaseClient
      .from("distinct_user_file_url")
      .select("url")
      .eq("user_id", user_id)

    if (error) {
      console.error(`Error while getting user distinct urls: ${error}`);
      return null;
    } 
    else {
      if (!urls || urls.length === 0) {
        return []
      }
      return urls.map((url) => url.url);
    }
  } catch (err) {
    console.error(`Exception occurred while getting user distinct urls: ${err}`);
    return null;
  }
}