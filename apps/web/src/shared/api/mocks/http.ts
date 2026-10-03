import { createOpenApiHttp } from 'openapi-msw'
import type { paths } from '@/shared/api/schema/generated'
import { CONFIG } from '@/shared/model/config'

export const http = createOpenApiHttp<paths>({
  baseUrl: CONFIG.API_BASE_URL,
})
