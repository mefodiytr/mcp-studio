import { describe, expect, it } from 'vitest';

import { invokeChannels, parseEvent, parseInvokeRequest, parseInvokeResponse } from './contract';

describe('IPC contract', () => {
  it('accepts a well-formed app:ping request and rejects malformed ones', () => {
    expect(parseInvokeRequest('app:ping', { at: 123 })).toEqual({ at: 123 });
    expect(() => parseInvokeRequest('app:ping', {})).toThrow();
    expect(() => parseInvokeRequest('app:ping', { at: 'not-a-number' })).toThrow();
    expect(() => parseInvokeRequest('app:ping', null)).toThrow();
  });

  it('accepts a well-formed app:ping response and rejects malformed ones', () => {
    expect(parseInvokeResponse('app:ping', { pong: true, at: 2, echoedAt: 1 })).toEqual({
      pong: true,
      at: 2,
      echoedAt: 1,
    });
    expect(() => parseInvokeResponse('app:ping', { pong: false, at: 2, echoedAt: 1 })).toThrow();
    expect(() => parseInvokeResponse('app:ping', { pong: true, at: 2 })).toThrow();
  });

  it('accepts a well-formed app:tick event and rejects malformed ones', () => {
    expect(parseEvent('app:tick', { seq: 0, at: 999 })).toEqual({ seq: 0, at: 999 });
    expect(() => parseEvent('app:tick', { seq: -1, at: 999 })).toThrow();
    expect(() => parseEvent('app:tick', { seq: 1.5, at: 999 })).toThrow();
    expect(() => parseEvent('app:tick', { seq: 1 })).toThrow();
  });

  it('declares a request and response schema for every invoke channel', () => {
    for (const [name, schemas] of Object.entries(invokeChannels)) {
      expect(schemas.request, `${name}.request`).toBeDefined();
      expect(schemas.response, `${name}.response`).toBeDefined();
    }
  });
});
