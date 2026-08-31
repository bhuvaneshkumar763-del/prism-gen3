import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTrustedSender } from './protocol';

describe('isTrustedSender', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });
  afterEach(() => {
    fakeBrowser.reset();
  });

  // Real bug this fixed: @webext-core/messaging's onMessage does no sender
  // validation of its own — any other installed extension could send this
  // extension's own message shapes straight to its handlers.
  it("accepts a sender whose id matches this extension's own runtime id", () => {
    expect(isTrustedSender({ id: browser.runtime.id } as Browser.runtime.MessageSender)).toBe(true);
  });

  it('rejects a sender from a different extension', () => {
    expect(isTrustedSender({ id: 'some-other-extension-id' } as Browser.runtime.MessageSender)).toBe(false);
  });

  it('rejects a sender with no id at all', () => {
    expect(isTrustedSender({} as Browser.runtime.MessageSender)).toBe(false);
  });
});
