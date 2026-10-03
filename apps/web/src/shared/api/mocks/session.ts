import { SignJWT, jwtVerify } from 'jose'
import { HttpResponse } from 'msw'

type Session = {
  userId: string
  email: string
}

const JWT_SECRET = new TextEncoder().encode('your-secret-key')
const ACCESS_TOKEN_EXPIRY = '3s'
const REFRESH_TOKEN_EXPIRY = '7d'

export const createRefreshTokenCookie = (refreshToken: string) => {
  return `refreshToken=${refreshToken}; Max-Age=604800`
}

export const generateTokens = async (session: Session) => {
  const accessToken = await new SignJWT(session)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET)

  const refreshToken = await new SignJWT(session)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(JWT_SECRET)

  return { accessToken, refreshToken }
}

export const verifyToken = async (token: string): Promise<Session> => {
  const { payload } = await jwtVerify(token, JWT_SECRET)
  return payload as Session
}

export const verifyTokenOrThrow = async (request: Request): Promise<Session> => {
  const token = request.headers.get('Authorization')?.split(' ')[1]
  const session = token ? await verifyToken(token).catch(() => null) : null
  if (!session) {
    throw HttpResponse.json(
      {
        message: 'Invalid token',
        code: 'INVALID_TOKEN',
      },
      { status: 401 }
    )
  }
  return session
}
