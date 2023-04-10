import { supabaseClient } from "@/lib/supabase";

export const getUserUrls = async (userId: number) => {
    const {data} = await supabaseClient.from("distinct_urls").select("url").eq("user_id", userId);
    if (data && data.length > 0) {
        return data;
    }
    return [];
}