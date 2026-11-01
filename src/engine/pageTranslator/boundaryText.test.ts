import { describe, expect, it } from 'vitest';
import { restoreBoundaryText } from './boundaryText';

describe('restoreBoundaryText', () => {
  it('keeps the translation own opening mark when the source had none', () => {
    expect(restoreBoundaryText({ leading: '', trailing: ' ' }, '¿Estás seguro?')).toBe('¿Estás seguro? ');
  });

  it('does not force the source opening mark onto a translation without one', () => {
    expect(restoreBoundaryText({ leading: '¿', trailing: ' ' }, "What's up?")).toBe("What's up? ");
  });

  it('carries a sentence-ending boundary the translator dropped or kept', () => {
    expect(restoreBoundaryText({ leading: '. ', trailing: ' ' }, 'El programa solo enseñaba.')).toBe(
      '. El programa solo enseñaba. ',
    );
  });

  it('does not duplicate a boundary the translator echoed back', () => {
    expect(restoreBoundaryText({ leading: '. ', trailing: '' }, '. El programa')).toBe('. El programa');
  });

  it('keeps a plain leading space', () => {
    expect(restoreBoundaryText({ leading: ' ', trailing: '' }, 'Leer')).toBe(' Leer');
  });

  it('does not carry a CJK opening bracket from the source', () => {
    expect(restoreBoundaryText({ leading: '「', trailing: ' ' }, 'Hello,')).toBe('Hello, ');
  });

  it('keeps the translation own CJK bracket', () => {
    expect(restoreBoundaryText({ leading: '', trailing: ' ' }, '「こんにちは」')).toBe('「こんにちは」 ');
  });

  it('carries a dash boundary once when the translator echoes it', () => {
    expect(restoreBoundaryText({ leading: '— ', trailing: '' }, '— Sí')).toBe('— Sí');
  });

  it('carries a dash boundary when the translator drops it', () => {
    expect(restoreBoundaryText({ leading: '— ', trailing: '' }, 'Sí')).toBe('— Sí');
  });

  it('collapses internal trailing whitespace in the translation', () => {
    expect(restoreBoundaryText({ leading: '', trailing: ' ' }, 'Hola  ')).toBe('Hola ');
  });

  it('carries the whitespace before an opening guillemet but not the guillemet itself', () => {
    expect(restoreBoundaryText({ leading: '  «', trailing: ' ' }, '«Bonjour»')).toBe('  «Bonjour» ');
  });

  it('keeps the translator own version of a closing mark instead of adding the source one', () => {
    expect(restoreBoundaryText({ leading: '。', trailing: '' }, '. Its theme is fidelity')).toBe(
      '. Its theme is fidelity',
    );
    expect(restoreBoundaryText({ leading: '、', trailing: '' }, ', and then')).toBe(', and then');
  });

  it('carries a CJK closing mark the translator dropped', () => {
    expect(restoreBoundaryText({ leading: '。', trailing: '' }, 'Its theme is fidelity')).toBe(
      '。Its theme is fidelity',
    );
  });
});
