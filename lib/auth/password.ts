import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt from Node itself, so there is no native dependency to break a
 * serverless build. The parameters travel inside the stored string, so they can be raised later
 * without invalidating anyone's password.
 */

const scrypt = promisify<string, Buffer, number, { N: number; r: number; p: number; maxmem: number }, Buffer>(scryptCb);

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const maxmemFor = (n: number, r: number) => 256 * n * r;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: maxmemFor(N, R) });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, nRaw, rRaw, pRaw, saltRaw, hashRaw] = stored.split("$");
  if (scheme !== "scrypt" || !nRaw || !rRaw || !pRaw || !saltRaw || !hashRaw) return false;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const expected = Buffer.from(hashRaw, "base64url");
  const actual = await scrypt(password, Buffer.from(saltRaw, "base64url"), expected.length, { N: n, r, p: Number(pRaw), maxmem: maxmemFor(n, r) });
  return timingSafeEqual(actual, expected);
}

/** Spent when the email is unknown, so a login attempt takes the same time either way. */
const DUMMY = hashPassword(randomBytes(16).toString("hex"));

export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, await DUMMY);
}
