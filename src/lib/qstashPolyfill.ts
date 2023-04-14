// @ts-ignore Deno can't compile
import { NextRequest, NextResponse } from "next/server";

import * as base64Url from '@/utils/base64url';

/**
 * Necessary to verify the signature of a request.
 */
type ReceiverConfig = {
  /**
   * The current signing key. Get it from `https://console.upstash.com/qstash
   */
  currentSigningKey: string;
  /**
   * The next signing key. Get it from `https://console.upstash.com/qstash
   */
  nextSigningKey: string;
};

type VerifyRequest = {
  /**
   * The signature from the `upstash-signature` header.
   */
  signature: string;

  /**
   * The raw request body.
   */
  body: string | Uint8Array;

  /**
   * URL of the endpoint where the request was sent to.
   */
  url?: string;
};


class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

class Receiver {
  private readonly currentSigningKey: string;
  private readonly nextSigningKey: string;

  constructor(config: ReceiverConfig) {
    this.currentSigningKey = config.currentSigningKey;
    this.nextSigningKey = config.nextSigningKey;
  }

  /**
   * Verify the signature of a request.
   *
   * Tries to verify the signature with the current signing key.
   * If that fails, maybe because you have rotated the keys recently, it will
   * try to verify the signature with the next signing key.
   *
   * If that fails, the signature is invalid and a `SignatureError` is thrown.
   */
  public async verify(req: VerifyRequest): Promise<boolean> {
    const isValid = await this.verifyWithKey(this.currentSigningKey, req);
    if (isValid) {
      return true;
    }
    return this.verifyWithKey(this.nextSigningKey, req);
  }

  /**
   * Verify signature with a specific signing key
   */
  private async verifyWithKey(
    key: string,
    req: VerifyRequest
  ): Promise<boolean> {
    const parts = req.signature.split('.');

    if (parts.length !== 3) {
      throw new SignatureError(
        '`Upstash-Signature` header is not a valid signature'
      );
    }
    const [header, payload, signature] = parts;

    const k = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const isValid = await crypto.subtle.verify(
      { name: 'HMAC' },
      k,
      base64Url.decode(signature),
      new TextEncoder().encode(`${header}.${payload}`)
    );

    if (!isValid) {
      throw new SignatureError('signature does not match');
    }

    const p: {
      iss: string;
      sub: string;
      exp: number;
      nbf: number;
      iat: number;
      jti: string;
      body: string;
    } = JSON.parse(new TextDecoder().decode(base64Url.decode(payload)));
    if (p.iss !== 'Upstash') {
      throw new SignatureError(`invalid issuer: ${p.iss}`);
    }

    if (typeof req.url !== 'undefined' && p.sub !== req.url) {
      throw new SignatureError(`invalid subject: ${p.sub}, want: ${req.url}`);
    }
    const now = Math.floor(Date.now() / 1000);
    if (now > p.exp) {
      console.log({ now, exp: p.exp });
      throw new SignatureError('token has expired');
    }
    if (now < p.nbf) {
      throw new SignatureError('token is not yet valid');
    }

    const bodyHash = await crypto.subtle.digest(
      'SHA-256',
      typeof req.body === 'string'
        ? new TextEncoder().encode(req.body)
        : req.body
    );

    const padding = new RegExp(/=+$/);

    if (
      p.body.replace(padding, '') !==
      base64Url.encode(bodyHash).replace(padding, '')
    ) {
      throw new SignatureError(
        `body hash does not match, want: ${p.body}, got: ${base64Url.encode(
          bodyHash
        )}`
      );
    }

    return true;
  }
}
export type VerifySignaturConfig = {
  currentSigningKey?: string;
  nextSigningKey?: string;
};

export type NextEdgeMessageHandler<T> = (
  message: T,
  request: NextRequest
) => Promise<NextResponse>;

function verifyEdgeSignature<T>(
  handler: NextEdgeMessageHandler<T>
): (request: NextRequest) => Promise<NextResponse> {
  const currentSigningKey = process.env['QSTASH_CURRENT_SIGNING_KEY'];
  if (!currentSigningKey) {
    throw new Error(
      'currentSigningKey is required, either in the config or as env variable QSTASH_CURRENT_SIGNING_KEY'
    );
  }
  const nextSigningKey = process.env['QSTASH_NEXT_SIGNING_KEY'];
  if (!nextSigningKey) {
    throw new Error(
      'nextSigningKey is required, either in the config or as env variable QSTASH_NEXT_SIGNING_KEY'
    );
  }

  const receiver = new Receiver({
    currentSigningKey,
    nextSigningKey,
  });

  return async (req: NextRequest) => {
    const signature = req.headers.get('upstash-signature');
    if (!signature) {
      throw new Error('`Upstash-Signature` header is missing');
    }
    if (typeof signature !== 'string') {
      throw new Error('`Upstash-Signature` header is not a string');
    }

    if (req.headers.get('content-type') != 'application/json') {
      throw new Error('`Content-Type` must be a JSON');
    }

    const body = await req.text();

    const isValid = await receiver.verify({
      signature,
      body,
    });
    if (!isValid) {
      return new NextResponse('Invalid signature', {
        status: 400,
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
    }

    const message: T = JSON.parse(body);
    return handler(message, req);
  };
}

export default verifyEdgeSignature;