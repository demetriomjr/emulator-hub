export function backendListenConfiguration(environment = process.env) {
  return {
    host: environment.HOST ?? '127.0.0.1',
    port: Number.parseInt(environment.PORT ?? '3001', 10),
  }
}
