// /api/logout — clear cookie, redirect home.
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/login`,
      'Set-Cookie': `pcafe_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
