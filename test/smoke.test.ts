import { describe, expect, it } from 'vitest';
import { createProgram, VERSION } from '../src/cli.js';

describe('CLI baseline', () => {
  it('exposes the package version', () => {
    expect(VERSION).toBe('0.1.0');
    expect(createProgram().version()).toBe(VERSION);
  });
});
