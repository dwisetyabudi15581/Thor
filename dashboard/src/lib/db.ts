// Database SQLite (Prisma). Path relatif file: diselesaikan
// terhadap folder dashboard/ (CWD saat server berjalan) supaya CLI prisma
// (db push) dan runtime client SELALU menunjuk file yang sama, di mana pun
// build standalone diletakkan.

import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const rawUrl = process.env.DATABASE_URL ?? 'file:db/custom.db'
const resolvedUrl = rawUrl.startsWith('file:') && !rawUrl.startsWith('file:/')
  ? `file:${path.resolve(process.cwd(), rawUrl.slice(5))}`
  : rawUrl

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    datasources: { db: { url: resolvedUrl } },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
