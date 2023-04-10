import { supabaseClient } from "@/lib/supabase";

export const isProcessed = async (userId: number, url: string) => {
  // Property 'data' does not exist on type 'PostgrestFilterBuilder<any, any, { url: any; }[]>'.ts(2339)
  try {
    const { data } = await supabaseClient
      .from("document")
      .select("url")
      .eq("user_id", userId)
      .eq("url", url);
    if (data && data.length > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error(error);
    return false;
  }
};
