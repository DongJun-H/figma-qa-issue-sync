import { Ratelimit } from '@upstash/ratelimit';
import { kv } from '@vercel/kv';

const ratelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(10, '1m'),  // 10 requests per minute
  analytics: true,
});

export default async function middleware(request) {
  const url = new URL(request.url);

  // Only apply rate limiting to API routes
  if (!url.pathname.startsWith('/api/')) {
    return;
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? '127.0.0.1';
  const { success, limit, reset, remaining } = await ratelimit.limit(ip);

  if (!success) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'Content-Type': 'text/plain',
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString(),
      }
    });
  }

  // Continue to the API route (no response = pass through)
  return;
}

export const config = {
  matcher: '/api/:path*',
};
