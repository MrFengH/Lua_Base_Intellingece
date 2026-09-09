import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '@/application/ports';

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class RandomIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
