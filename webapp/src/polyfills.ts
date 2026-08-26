/**
 * Node-compat polyfills for browser bundles that depend on isomorphic
 * libraries (@ton/core, @tonconnect) referencing the Buffer global.
 * MUST be imported before anything else in main.tsx.
 */
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
if (typeof g.global === 'undefined') g.global = globalThis;

export {};
