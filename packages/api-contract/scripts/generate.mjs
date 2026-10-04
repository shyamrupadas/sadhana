import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
const document = JSON.parse(await readFile(process.argv[2] ? pathToFileURL(process.argv[2]) : new URL('generated/openapi/openapi.json', root), 'utf8'))

function fail(where, reason) {
  throw new Error(`Unsupported contract construct at ${where}: ${reason}`)
}

function onlyKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(where, key)
  }
}

function validateSchema(schema, where) {
  if (!schema || typeof schema !== 'object') fail(where, 'missing schema')
  const allowed = new Set(['$ref', 'type', 'format', 'description', 'required', 'properties', 'items', 'enum', 'nullable', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern'])
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) fail(where, key)
  }
  if (schema.$ref) {
    if (Object.keys(schema).some((key) => key !== '$ref' && key !== 'description')) fail(where, 'reference siblings')
    if (!schema.$ref.startsWith('#/components/schemas/')) fail(where, 'external reference')
    const name = schema.$ref.slice('#/components/schemas/'.length)
    if (!document.components?.schemas?.[name]) fail(where, `missing reference ${name}`)
    return
  }
  if (!['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(schema.type)) fail(where, `type ${schema.type}`)
  if (schema.type === 'array') validateSchema(schema.items, `${where}.items`)
  if (schema.type === 'object') {
    if (schema.properties === undefined) fail(where, 'object without properties')
    for (const [name, property] of Object.entries(schema.properties)) validateSchema(property, `${where}.${name}`)
  }
}

if (document.openapi !== '3.0.0') fail('openapi', `version ${document.openapi}`)
onlyKeys(document, ['openapi', 'info', 'tags', 'paths', 'components'], 'document')
onlyKeys(document.components ?? {}, ['schemas', 'securitySchemes'], 'components')
for (const [name, scheme] of Object.entries(document.components?.securitySchemes ?? {})) {
  if (name !== 'BearerAuth' || scheme.type !== 'http' || scheme.scheme?.toLowerCase() !== 'bearer') fail(`securitySchemes.${name}`, 'security scheme')
}
for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) validateSchema(schema, `schemas.${name}`)
const operations = []
for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  if (!path.startsWith('/')) fail(path, 'relative path')
  onlyKeys(pathItem, ['get', 'post', 'patch', 'put', 'delete'], path)
  for (const [verb, operation] of Object.entries(pathItem)) {
    onlyKeys(operation, ['operationId', 'summary', 'description', 'parameters', 'requestBody', 'responses', 'security', 'tags'], `${path}.${verb}`)
    if (!operation.operationId || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(operation.operationId)) fail(path, 'operationId')
    for (const parameter of operation.parameters ?? []) {
      onlyKeys(parameter, ['name', 'in', 'required', 'schema', 'explode'], `${operation.operationId}.parameter`)
      const cookie = parameter.in === 'cookie' && parameter.name === 'refreshToken' && parameter.required === false
      const pathParameter = parameter.in === 'path' && parameter.required === true && path.includes(`{${parameter.name}}`)
      const parameterType = parameter.schema?.$ref
        ? document.components.schemas[parameter.schema.$ref.slice('#/components/schemas/'.length)]?.type
        : parameter.schema?.type
      if ((!cookie && !pathParameter) || parameterType !== 'string') fail(operation.operationId, 'parameter')
      validateSchema(parameter.schema, `${operation.operationId}.parameter`)
    }
    const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
    if (placeholders.length !== (operation.parameters ?? []).filter((parameter) => parameter.in === 'path').length || placeholders.some((name) => !operation.parameters?.some((parameter) => parameter.in === 'path' && parameter.name === name))) fail(operation.operationId, 'path parameters')
    if (operation.requestBody) {
      onlyKeys(operation.requestBody, ['required', 'content'], `${operation.operationId}.requestBody`)
      if (operation.requestBody.required !== true || Object.keys(operation.requestBody.content ?? {}).join() !== 'application/json') fail(operation.operationId, 'request body content')
      onlyKeys(operation.requestBody.content['application/json'], ['schema'], `${operation.operationId}.requestBody.content`)
      validateSchema(operation.requestBody.content['application/json'].schema, `${operation.operationId}.requestBody`)
    }
    if (operation.security && JSON.stringify(operation.security) !== '[{"BearerAuth":[]}]') fail(operation.operationId, 'security')
    const responses = Object.entries(operation.responses ?? {})
    if (!responses.length || !responses.some(([status]) => status.startsWith('2'))) fail(operation.operationId, 'success response')
    for (const [status, response] of responses) {
      if (!/^[1-5][0-9]{2}$/.test(status)) fail(operation.operationId, `status ${status}`)
      onlyKeys(response, ['description', 'content', 'headers'], `${operation.operationId}.${status}`)
      for (const [name, header] of Object.entries(response.headers ?? {})) {
        if (name !== 'Set-Cookie') fail(operation.operationId, `header ${name}`)
        onlyKeys(header, ['required', 'schema'], `${operation.operationId}.${status}.header`)
        if (header.required !== true || header.schema?.type !== 'string') fail(operation.operationId, 'Set-Cookie header')
        validateSchema(header.schema, `${operation.operationId}.${status}.header`)
      }
      const content = response.content
      if (content && (Object.keys(content).length !== 1 || !content['application/json'])) fail(operation.operationId, `content ${status}`)
      if (content) {
        onlyKeys(content['application/json'], ['schema'], `${operation.operationId}.${status}.content`)
        validateSchema(content['application/json'].schema, `${operation.operationId}.${status}`)
      }
    }
    const methodName = operation.operationId.includes('_') ? operation.operationId.split('_').at(-1) : operation.operationId
    if (operations.some((item) => item.methodName === methodName)) fail(operation.operationId, 'duplicate method name')
    operations.push({ path, verb, id: operation.operationId, methodName, responses, requestBody: operation.requestBody, parameters: operation.parameters ?? [], secured: !!operation.security })
  }
}
operations.sort((a, b) => a.id.localeCompare(b.id))

const header = '// Generated by scripts/generate.mjs. Do not edit.\n'
const typeFor = (operation, status) => operation.responses.find(([code]) => code === status)?.[1].content
  ? `Operations[${JSON.stringify(operation.id)}]['responses'][${status}]['content']['application/json']`
  : 'undefined'
const requestType = (operation) => `Operations[${JSON.stringify(operation.id)}]['requestBody']['content']['application/json']`
const clientMethods = operations.map((operation) => {
  const success = operation.responses.filter(([status]) => status.startsWith('2'))
  const successType = success.map(([status]) => typeFor(operation, status)).join(' | ')
  const pathParameters = operation.parameters.filter((parameter) => parameter.in === 'path')
  const pathArgs = pathParameters.map((parameter) => `${parameter.name}: string, `).join('')
  const bodyArg = operation.requestBody ? `body: ${requestType(operation)}, ` : ''
  const bodyInit = operation.requestBody ? ", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)" : ''
  const requestPath = pathParameters.length
    ? '`' + operation.path.replace(/\{([^}]+)\}/g, (_, name) => '${encodeURIComponent(' + name + ')}') + '`'
    : JSON.stringify(operation.path)
  return `  ${operation.methodName}(${pathArgs}${bodyArg}options: { signal?: AbortSignal } = {}): Promise<${successType}> {\n    return this.request(${requestPath}, { method: ${JSON.stringify(operation.verb.toUpperCase())}, signal: options.signal${bodyInit} })\n  }`
}).join('\n\n')
const client = `${header}import type { operations as Operations } from './openapi/types.js'\n\nexport interface ApiClientOptions {\n  baseUrl?: string\n  fetch?: typeof fetch\n}\n\nexport class ApiClientError extends Error {\n  constructor(readonly status: number, readonly body: unknown) {\n    super(typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : \`HTTP \${status}\`)\n  }\n}\n\nexport class ApiClient {\n  constructor(private readonly options: ApiClientOptions = {}) {}\n\n${clientMethods}\n\n  private async request<T>(path: string, init: RequestInit): Promise<T> {\n    const response = await (this.options.fetch ?? fetch)(\`\${this.options.baseUrl ?? ''}\${path}\`, init)\n    const raw = response.status === 204 ? '' : await response.text()\n    let body: unknown\n    try { body = raw ? JSON.parse(raw) : undefined } catch { body = raw }\n    if (!response.ok) throw new ApiClientError(response.status, body)\n    return body as T\n  }\n}\n`
const handlerMembers = operations.map((operation) => {
  const variants = operation.responses.map(([status, response]) => `ApiHandlerResponse<${status}, ${typeFor(operation, status)}${response.headers ? ", { 'Set-Cookie': string }" : ''}>`).join(' | ')
  const fields = [operation.secured ? 'user: { id: string; email: string }' : '', operation.requestBody ? `body: ${requestType(operation)}` : '', ...operation.parameters.map((parameter) => `${parameter.name}${parameter.required ? '' : '?'}: string`), ...((operation.responses.some(([, response]) => response.headers)) ? ['isHttps: boolean'] : [])].filter(Boolean)
  const context = fields.length ? `{ ${fields.join('; ')} }` : 'Record<string, never>'
  return `  ${operation.methodName}(context: ${context}): Promise<${variants}> | ${variants}`
}).join('\n')
const handlers = `${header}import type { operations as Operations } from './openapi/types.js'\n\nexport interface ApiHandlerContext {\n  user: { id: string; email: string }\n}\n\nexport type ApiHandlerResponse<S extends number, B = undefined, H = undefined> = { status: S } & (B extends undefined ? object : { body: B }) & (H extends undefined ? object : { headers: H })\n\nexport interface ApiHandlers {\n${handlerMembers}\n}\n`
await writeFile(new URL('generated/client.ts', root), client)
await writeFile(new URL('generated/handlers.ts', root), handlers)
