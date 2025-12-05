import { HttpResponse } from 'msw'
import { http } from '../http'
import { ApiShemas } from '../../schema'

const user: ApiShemas['User'] = {
  id: '01',
  email: 'my@email.ru',
}

export const handlers = [
  http.post('/auth/login', () => {
    return HttpResponse.json({ user, accessToken: 'fjdks' })
  }),
]
