import fs from 'node:fs'
import path from 'node:path'

/** Small JSON document persisted atomically with debounced writes. */
export class JsonStore<T> {
  private data: T
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly defaults: () => T,
    private readonly normalize: (raw: unknown) => T
  ) {
    this.data = this.read()
  }

  private read(): T {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return this.normalize(raw)
    } catch {
      return this.defaults()
    }
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[clauditor] failed to persist', this.file, err)
    }
  }
}
