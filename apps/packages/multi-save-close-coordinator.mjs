const DEFAULT_RETRY = Object.freeze({ maxAttempts: 3, delays: [250, 750] })

export function createMultiSaveCloseCoordinator({ tasks = [], retry = {}, onUpdate = () => {}, wait = delay => new Promise(resolve => setTimeout(resolve, delay)) } = {}) {
  if (!Array.isArray(tasks) || tasks.some(task => !task || typeof task.id !== 'string' || typeof task.run !== 'function')) throw new TypeError('Save tasks are invalid.')
  const policy = { ...DEFAULT_RETRY, ...retry }
  const rows = tasks.map(task => ({ id: task.id, label: task.label ?? task.id, status: 'pending', attempt: 0, error: null }))
  const byId = new Map(tasks.map((task, index) => [task.id, { task, index }]))
  let running = null
  publish()

  return { run: () => runRows(rows.filter(row => row.status !== 'saved')), retryFailed: () => runRows(rows.filter(row => row.status === 'failed')),
    getRows: () => rows.map(row => ({ ...row })) }

  async function runRows(selected) {
    if (running) return running
    running = Promise.all(selected.map(row => execute(row))).then(() => {
      publish()
      return rows.map(row => ({ ...row }))
    }).finally(() => { running = null })
    return running
  }

  async function execute(row) {
    const task = byId.get(row.id).task
    row.status = 'processing'
    row.error = null
    publish()
    const maxAttempts = Math.max(1, Number(policy.maxAttempts) || 1)
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      row.attempt = attempt
      publish()
      try {
        await task.run({ attempt })
        row.status = 'saved'
        row.error = null
        publish()
        return
      } catch (error) {
        row.error = error
        const transient = error?.transient === true || error?.status >= 500 || error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET'
        if (!transient || attempt >= maxAttempts) {
          row.status = 'failed'
          publish()
          return
        }
        row.status = 'retrying'
        publish()
        await wait(Math.max(0, Number(policy.delays?.[attempt - 1] ?? 0) || 0))
        row.status = 'processing'
        publish()
      }
    }
  }

  function publish() { onUpdate(rows.map(row => ({ ...row }))) }
}

