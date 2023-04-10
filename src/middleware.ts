import { NextRequest, NextResponse } from "next/server";
import { allowedIpRanges } from "./utils/constants";
import { inRange } from "range_check";

export const config = {
  matcher: [
    "/((?!_next/|_proxy/|_auth/|_root/|_static|static|_vercel|[\\w-]+\\.\\w+).*)",
  ],
};


export default async function middleware(req: NextRequest) {
  // get origin
  const { url } = req;
  let ip = req.ip ?? req.headers.get('x-real-ip')
  const forwardedFor = req.headers.get('x-forwarded-for')
  if(!ip && forwardedFor){
    ip = forwardedFor.split(',').at(0) ?? 'Unknown'
  }

  console.log(`Ip address: ${ip}`)
  console.log(`Url: ${url}`);

  // if (!ip || !inRange(ip, allowedIpRanges)) {
  //   return new NextResponse("Forbidden", { status: 404 });
  // }

  if (req.method === "OPTIONS") {
    return new NextResponse("ok", { status: 200 });
  }

  // check if the request is for the api and if the secret key is correct
  if (url && (url.includes("/api/tlg/") || url.includes("/api/qstash"))) {
    const lastPart = url.split("/").pop();
    if (lastPart == process.env.NEXT_SECRET_KEY) {
      return NextResponse.next();
    }
  }

  return NextResponse.next();
  // return new NextResponse("Not Found", { status: 404 });
}
