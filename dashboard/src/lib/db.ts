// Database user dashboard — otomatis menyesuaikan platform.
//
// - Linux/macOS/Windows (VPS, PC): Prisma + SQLite (file db/custom.db) —
//   perilaku sama persis dengan versi sebelumnya.
// - Android/Termux: mesin Prisma adalah binary glibc yang TIDAK BISA dimuat
//   di Android (bionic libc) — otomatis dipakai penyimpanan JSON sederhana
//   (db/custom-users.json) dengan antarmuka yang sama dengan seluruh
//   pemakaian `db.user` di dashboard (findUnique / create / update /
//   upsert / count), jadi tidak ada kode pemanggil yang perlu berubah.

import path from 'node:path'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

type DbUser = {
  id: string
  discordId: string
  username: string
  globalName: string | null
  avatar: string | null
  isAdmin: boolean
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type UserData = Partial<Omit<DbUser, 'id' | 'discordId'>> & { id?: string; discordId?: string }
type UserWhere = { id?: string; discordId?: string }

type UserDelegate = {
  findUnique(args: { where: UserWhere }): Promise<DbUser | null>
  create(args: { data: UserData }): Promise<DbUser>
  update(args: { where: UserWhere; data: UserData }): Promise<DbUser>
  upsert(args: { where: { discordId: string }; create: UserData; update: UserData }): Promise<DbUser>
  count(): Promise<number>
}

// Bentuk yang dipakai seluruh kode dashboard: db.user.<method>
type Db = { user: UserDelegate }

const rawUrl = process.env.DATABASE_URL ?? 'file:db/custom.db'
const resolvedUrl = rawUrl.startsWith('file:') && !rawUrl.startsWith('file:/')
  ? `file:${path.resolve(process.cwd(), rawUrl.slice(5))}`
  : rawUrl

// ---------- Penyimpanan JSON (Android/Termux) ----------

const DATE_FIELDS = ['tokenExpiresAt', 'createdAt', 'updatedAt'] as const

class JsonUserStore implements UserDelegate {
  private file: string
  private records: DbUser[]

  constructor(file: string) {
    this.file = file
    this.records = []
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        if (Array.isArray(parsed)) this.records = parsed.map((r) => JsonUserStore.revive(r))
      } catch {
        this.records = [] // file korup → mulai kosong (user cukup login ulang)
      }
    }
  }

  private static revive(raw: Record<string, unknown>): DbUser {
    const user = { ...raw }
    for (const f of DATE_FIELDS) {
      if (typeof user[f] === 'string') user[f] = new Date(user[f] as string)
    }
    return user as unknown as DbUser
  }

  private persist() {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.records, null, 2), 'utf8')
    renameSync(tmp, this.file) // atomik: tidak pernah ada file setengah tertulis
  }

  private find(where: UserWhere): DbUser | undefined {
    return this.records.find(
      (u) =>
        (where.id === undefined || u.id === where.id) &&
        (where.discordId === undefined || u.discordId === where.discordId),
    )
  }

  private static defaults(data: UserData): DbUser {
    const now = new Date()
    return {
      id: data.id ?? randomUUID(),
      discordId: data.discordId ?? '',
      username: data.username ?? '',
      globalName: null,
      avatar: null,
      isAdmin: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    } as DbUser
  }

  async findUnique({ where }: { where: UserWhere }) {
    const found = this.find(where)
    return found ? { ...found } : null
  }

  async create({ data }: { data: UserData }) {
    // meniru unique constraint Prisma (P2002) — pemanggil menangani via try/catch
    const duplikat =
      (data.id !== undefined && this.find({ id: data.id }) !== undefined) ||
      (data.discordId !== undefined && this.find({ discordId: data.discordId }) !== undefined)
    if (duplikat) throw new Error('Unique constraint failed: baris user sudah ada')
    const user = JsonUserStore.defaults(data)
    this.records.push(user)
    this.persist()
    return { ...user }
  }

  async update({ where, data }: { where: UserWhere; data: UserData }) {
    const found = this.find(where)
    if (!found) throw new Error('User tidak ditemukan') // meniru P2025 Prisma
    Object.assign(found, data, { updatedAt: new Date() })
    this.persist()
    return { ...found }
  }

  async upsert(args: { where: { discordId: string }; create: UserData; update: UserData }) {
    const found = this.find(args.where)
    if (found) return this.update({ where: args.where, data: args.update })
    return this.create({ data: { ...args.create, discordId: args.where.discordId } })
  }

  async count() {
    return this.records.length
  }
}

// ---------- Inisialisasi per platform ----------

const globalForDb = globalThis as unknown as { thorDb?: Db }

function createDb(): Db {
  if (process.platform === 'android') {
    // Termux: engine Prisma tidak bisa dimuat → penyimpanan JSON.
    // Letak file mengikuti DATABASE_URL: db/custom.db → db/custom-users.json
    const jsonPath = resolvedUrl.startsWith('file:')
      ? resolvedUrl.slice(5).replace(/\.db$/i, '') + '-users.json'
      : path.resolve(process.cwd(), 'db/custom-users.json')
    console.warn(`[db] Android/Termux terdeteksi — penyimpanan user pakai JSON: ${jsonPath}`)
    return { user: new JsonUserStore(jsonPath) }
  }
  // require (bukan import statis) supaya runtime Prisma tidak pernah
  // dievaluasi sama sekali di Android. Di platform lain Prisma memakai
  // DATABASE_URL absolut — identik dengan perilaku sebelumnya.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient({
    log: ['query'],
    datasources: { db: { url: resolvedUrl } },
  })
  // PrismaClient punya properti `user` yang merupakan super-set dari
  // UserDelegate — aman di-cast
  return prisma as unknown as Db
}

export const db: Db = (globalForDb.thorDb ??= createDb())
