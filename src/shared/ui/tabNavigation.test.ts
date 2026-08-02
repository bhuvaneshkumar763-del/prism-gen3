import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './tabNavigation';

describe('nextTabIndex', () => {
  it('ArrowRight advances by one', () => {
    expect(nextTabIndex('ArrowRight', 0, 5)).toBe(1);
  });
  it('ArrowRight wraps from the last tab to the first', () => {
    expect(nextTabIndex('ArrowRight', 4, 5)).toBe(0);
  });
  it('ArrowLeft moves back by one', () => {
    expect(nextTabIndex('ArrowLeft', 2, 5)).toBe(1);
  });
  it('ArrowLeft wraps from the first tab to the last', () => {
    expect(nextTabIndex('ArrowLeft', 0, 5)).toBe(4);
  });
  it('Home jumps to the first tab', () => {
    expect(nextTabIndex('Home', 3, 5)).toBe(0);
  });
  it('End jumps to the last tab', () => {
    expect(nextTabIndex('End', 0, 5)).toBe(4);
  });
  it('returns null for a non-navigation key', () => {
    expect(nextTabIndex('Enter', 0, 5)).toBeNull();
  });
  it('returns null when there are no tabs', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
