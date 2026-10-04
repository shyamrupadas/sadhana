import { createOpenApiHttp } from 'openapi-msw'
import type { paths } from '@sadhana/api-contract'
import { CONFIG } from '@/shared/model/config'

export const http = createOpenApiHttp<paths>({
  baseUrl: CONFIG.API_BASE_URL,
})
