import { HttpResponse } from 'msw'
import { http } from '../http'
import { ApiShemas } from '../../schema'

const mockUsers: ApiShemas['User'][] = [{ id: '1', email: 'admin@gmail.com' }]
const user: ApiShemas['User'] = {
  id: '01',
  email: 'my@email.ru',
}

const userPasswords = new Map<string, string>()
userPasswords.set('admin@gmail.com', '123456')

const mockTokens = new Map<string, string>()

export const authHandlers = [
  http.post('/auth/login', async ({ request }) => {
    const body = await request.json()

    const user = mockUsers.find(({ email }) => email === body.email)
    const storedPassword = userPasswords.get(body.email)

    if (!user || !storedPassword || storedPassword !== body.password) {
      return HttpResponse.json(
        {
          message: 'Неверный email или пароль',
          code: 'AUTH_INVALID_CREDENTIALS',
        },
        { status: 401 }
      )
    }

    const token = `mock-token-${Date.now()}`

    return HttpResponse.json({ user, accessToken: token }, { status: 200 })
  }),

  http.post('/auth/register', async ({ request }) => {
    const body = await request.json()

    if (mockUsers.some(({ email }) => email === body.email)) {
      return HttpResponse.json(
        {
          message: 'Пользователь уже существует',
          code: 'USER_EXISTS',
        },
        { status: 400 }
      )
    }

    const newUser: ApiShemas['User'] = {
      id: String(mockUsers.length + 1),
      email: body.email,
    }

    const token = `mock-token-${Date.now()}`
    mockUsers.push(newUser)
    userPasswords.set(body.email, body.password)
    mockTokens.set(body.email, token)

    return HttpResponse.json({ user: newUser, accessToken: token }, { status: 201 })
  }),
]
