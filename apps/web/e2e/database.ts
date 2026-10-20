import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

export function database<T = void>(command: string, input: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'pnpm',
      ['--filter', '@sadhana/api', 'exec', 'tsx', 'test/e2e/database.ts', command],
      { cwd: repositoryRoot, timeout: 45_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr.trim() || 'Не удалось выполнить подготовку/очистку данных E2E'
            )
          )
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error('Некорректный ответ утилиты данных E2E'))
        }
      }
    )
    child.stdin!.end(JSON.stringify(input))
  })
}
