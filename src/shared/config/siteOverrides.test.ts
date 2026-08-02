import { describe, expect, it } from 'vitest';
import {
  clearBubbleOverrideForHost,
  clearSourceLanguageOverrideForHost,
  resolveBubbleVisibility,
  resolveSourceLanguageForHost,
  setBubbleVisibilityForHost,
  setSourceLanguageForHost,
} from './siteOverrides';

describe('resolveBubbleVisibility', () => {
  it('falls back to the global default when the host has no override', () => {
    expect(resolveBubbleVisibility({ hostname: 'example.com', bubbleEnabled: true, bubbleByHost: {} })).toBe(true);
    expect(resolveBubbleVisibility({ hostname: 'example.com', bubbleEnabled: false, bubbleByHost: {} })).toBe(false);
  });
  it('an explicit false override wins over a true global default', () => {
    expect(
      resolveBubbleVisibility({ hostname: 'example.com', bubbleEnabled: true, bubbleByHost: { 'example.com': false } }),
    ).toBe(false);
  });
  it('an explicit true override wins over a false global default', () => {
    expect(
      resolveBubbleVisibility({ hostname: 'example.com', bubbleEnabled: false, bubbleByHost: { 'example.com': true } }),
    ).toBe(true);
  });
  it("does not apply another hostname's override", () => {
    expect(
      resolveBubbleVisibility({ hostname: 'other.com', bubbleEnabled: true, bubbleByHost: { 'example.com': false } }),
    ).toBe(true);
  });
});

describe('setBubbleVisibilityForHost / clearBubbleOverrideForHost', () => {
  it('sets an override without mutating the input map', () => {
    const input = {};
    const next = setBubbleVisibilityForHost(input, 'example.com', false);
    expect(next).toEqual({ 'example.com': false });
    expect(input).toEqual({});
  });
  it('clears an override without mutating the input map', () => {
    const input = { 'example.com': false, 'other.com': true };
    const next = clearBubbleOverrideForHost(input, 'example.com');
    expect(next).toEqual({ 'other.com': true });
    expect(input).toEqual({ 'example.com': false, 'other.com': true });
  });
  it('clearing a host with no existing override is a no-op', () => {
    const input = { 'other.com': true };
    expect(clearBubbleOverrideForHost(input, 'example.com')).toEqual({ 'other.com': true });
  });
});

describe('resolveSourceLanguageForHost', () => {
  it('returns the saved override', () => {
    expect(resolveSourceLanguageForHost({ 'example.com': 'ja' }, 'example.com', 'auto')).toBe('ja');
  });
  it('falls back when no override is saved', () => {
    expect(resolveSourceLanguageForHost({}, 'example.com', 'auto')).toBe('auto');
  });
});

describe('setSourceLanguageForHost', () => {
  it('sets a real language override without mutating the input map', () => {
    const input = {};
    const next = setSourceLanguageForHost(input, 'example.com', 'ja');
    expect(next).toEqual({ 'example.com': 'ja' });
    expect(input).toEqual({});
  });
  it('setting "auto" clears any existing override instead of storing the literal string', () => {
    const input = { 'example.com': 'ja' };
    const next = setSourceLanguageForHost(input, 'example.com', 'auto');
    expect(next).toEqual({});
  });
  it('setting "auto" with no existing override is a no-op', () => {
    expect(setSourceLanguageForHost({}, 'example.com', 'auto')).toEqual({});
  });
});

describe('clearSourceLanguageOverrideForHost', () => {
  it('removes an override without mutating the input map', () => {
    const input = { 'example.com': 'ja', 'other.com': 'fr' };
    const next = clearSourceLanguageOverrideForHost(input, 'example.com');
    expect(next).toEqual({ 'other.com': 'fr' });
    expect(input).toEqual({ 'example.com': 'ja', 'other.com': 'fr' });
  });
  it('is a no-op when the host has no override', () => {
    expect(clearSourceLanguageOverrideForHost({ 'other.com': 'fr' }, 'example.com')).toEqual({ 'other.com': 'fr' });
  });
});
