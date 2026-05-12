import { describe, expect, it } from 'vitest';

import { buildBqlQuery, parseTsv, stripStrayLimit } from './bql';

describe('stripStrayLimit', () => {
  it('removes a trailing SQL-style LIMIT (any case, optional semicolon)', () => {
    expect(stripStrayLimit('select x from y limit 5')).toEqual({ query: 'select x from y', stripped: true });
    expect(stripStrayLimit('select x from y LIMIT 100;')).toEqual({ query: 'select x from y', stripped: true });
  });
  it('leaves a query without a trailing LIMIT alone', () => {
    expect(stripStrayLimit('select x from y where z = 1')).toEqual({ query: 'select x from y where z = 1', stripped: false });
    // a column literally named "limit5" must not be touched
    expect(stripStrayLimit('select limit5 from y')).toEqual({ query: 'select limit5 from y', stripped: false });
  });
});

describe('buildBqlQuery', () => {
  it('prepends the base ORD + |bql: marker to a plain SELECT', () => {
    expect(buildBqlQuery('station:|slot:/Drivers', 'select displayName, out from control:ControlPoint')).toEqual({
      query: 'station:|slot:/Drivers|bql:select displayName, out from control:ControlPoint',
      strayLimit: false,
    });
  });
  it('coerces a bare/relative base ORD to the full station:|slot: form', () => {
    expect(buildBqlQuery('/Drivers', 'select displayName from baja:Component').query).toBe(
      'station:|slot:/Drivers|bql:select displayName from baja:Component',
    );
    expect(buildBqlQuery('slot:/', 'select x from y').query).toBe('station:|slot:/|bql:select x from y');
  });
  it('passes a query that already has an |bql: prefix through verbatim', () => {
    const full = 'station:|slot:/Logic|bql:select displayName from control:NumericPoint';
    expect(buildBqlQuery('station:|slot:/ignored', full)).toEqual({ query: full, strayLimit: false });
  });
  it('strips a stray LIMIT and flags it', () => {
    expect(buildBqlQuery('station:|slot:/', 'select x from y limit 10')).toEqual({
      query: 'station:|slot:/|bql:select x from y',
      strayLimit: true,
    });
  });
});

describe('parseTsv', () => {
  it('parses headers, rows, and the [rows=N] footer (the recorded sample)', () => {
    expect(parseTsv('Display Name\tOut\noat\t- {null} @ def\n\n[rows=1]')).toEqual({
      columns: ['Display Name', 'Out'],
      rows: [['oat', '- {null} @ def']],
      rowCount: 1,
    });
  });
  it('handles CRLF, a missing footer, and trailing blank lines', () => {
    expect(parseTsv('a\tb\r\n1\t2\r\n3\t4\r\n\r\n')).toEqual({
      columns: ['a', 'b'],
      rows: [['1', '2'], ['3', '4']],
      rowCount: 2,
    });
  });
  it('treats an empty body as no columns / no rows', () => {
    expect(parseTsv('')).toEqual({ columns: [], rows: [], rowCount: 0 });
    expect(parseTsv('\n[rows=0]')).toEqual({ columns: [], rows: [], rowCount: 0 });
  });
  it('keeps a header-only result (zero data rows)', () => {
    expect(parseTsv('Name\tType\n\n[rows=0]')).toEqual({ columns: ['Name', 'Type'], rows: [], rowCount: 0 });
  });
});
