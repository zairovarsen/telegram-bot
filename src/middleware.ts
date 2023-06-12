import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: [
    '/((?!_next/|_proxy/|_auth/|_root/|_static|static|_vercel|[\\w-]+\\.\\w+).*)',
  ],
}

// https://api.telegram.org/bot6265645703:AAHAahkwSKsmAkx5zUvlzfVQe9D_gwUbzFs/setWebhook?url=https://e9bd-5-76-190-114.eu.ngrok.io/api/tlg/3953fe1a736753754aefa15db40c523e295864d7&drop_pending_updates=true&allowed_updates=["message","callback_query","pre_checkout_query"]&secret_token=3953fe1a736753754aefa15db40c523e295864d7

export default async function middleware(req: NextRequest) {
  const { url } = req
  let ip = req.ip ?? req.headers.get('x-real-ip')
  const forwardedFor = req.headers.get('x-forwarded-for')
  const token = req.headers.get('X-Telegram-Bot-Api-Secret-Token')
  const signature = req.headers.get('upstash-signature')

  console.log(`Ip address: ${ip}`)
  console.log(`Url: ${url}`)

  if (!ip && forwardedFor) {
    ip = forwardedFor.split(',').at(0) ?? 'Unknown'
  }

  // check if the request is for the api and if the secret key is correct
  if ((url && url.includes('/api/tlg/')) || url.includes('/api/qstash/')) {
    if (token == process.env.NEXT_SECRET_KEY) {
      return NextResponse.next()
    } else if (signature) {
      return NextResponse.next()
    } else {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  return new NextResponse('Forbidden', { status: 403 })
}
