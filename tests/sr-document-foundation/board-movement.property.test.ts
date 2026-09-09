import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { adjacentColumn, COLUMNS, type BoardMoveDirection, type Column } from '../../src/shared/limits.js';

const columns = COLUMNS.map(([column]) => column);
const columnArb = fc.constantFrom<Column>(...columns);
const directionArb = fc.constantFrom<BoardMoveDirection>('previous', 'next');
const propertyOptions = { seed: 424242, numRuns: 150 };

describe('manual board adjacency properties', () => {
  test('movement is exactly one canonical step or absent at a boundary', () => {
    fc.assert(fc.property(columnArb, directionArb, (column, direction) => {
      const index = columns.indexOf(column); const moved = adjacentColumn(column, direction);
      const expectedIndex = direction === 'previous' ? index - 1 : index + 1;
      if (expectedIndex < 0 || expectedIndex >= columns.length) expect(moved).toBeUndefined();
      else expect(moved).toBe(columns[expectedIndex]);
    }), propertyOptions);
  });

  test('an adjacent move and its inverse return the original column', () => {
    fc.assert(fc.property(columnArb, directionArb, (column, direction) => {
      const moved = adjacentColumn(column, direction); fc.pre(moved !== undefined);
      expect(adjacentColumn(moved, direction === 'previous' ? 'next' : 'previous')).toBe(column);
    }), propertyOptions);
  });
});
