import { NextRequest, NextResponse } from "next/server";
import { ipRateLimit } from "@/lib/rate-limit";

export const config = {
  matcher: [
    "/((?!_next/|_proxy/|_auth/|_root/|_static|static|_vercel|[\\w-]+\\.\\w+).*)",
  ],
};


export default async function middleware(req: NextRequest) {
  const { url } = req;
  let ip = req.ip ?? req.headers.get('x-real-ip')
  const forwardedFor = req.headers.get('x-forwarded-for')
  if(!ip && forwardedFor){
    ip = forwardedFor.split(',').at(0) ?? 'Unknown'
  }

  console.log(`Ip address: ${ip}`)
  console.log(`Url: ${url}`);

  if (!ip) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // check if the request is for the api and if the secret key is correct
  if (url && (url.includes("/api/tlg/")) || url.includes('/api/qstash/')) {
   const rateLimitResult = await ipRateLimit(ip);

    if (!rateLimitResult.result.success) {
      return new NextResponse(
        `⚠️ Rate Limit Exceeded ⚠️`,
        { status: 429 }
      );
    }
    
    const lastPart = url.split("/").pop();
    const signature = req.headers.get("upstash-signature");

    if (lastPart == process.env.NEXT_SECRET_KEY) {
      console.log('called')
      return NextResponse.next();
    }

    if (signature) {
      return NextResponse.next();
    }
  }

  
  return new NextResponse("Forbidden", { status: 403 }); 
}
