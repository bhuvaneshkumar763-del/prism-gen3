import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTrustedSender, onTrustedMessage } from './protocol';

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

describe('onTrustedMessage', () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    fakeBrowser.reset();
  });
  afterEach(() => {
    // One listener per message type per context: remove it before the next test registers again.
    unsubscribe?.();
    unsubscribe = undefined;
    fakeBrowser.reset();
  });

  async function deliver(sender: Browser.runtime.MessageSender): Promise<unknown> {
    const sendResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger(
      { id: 1, type: 'getPageWorking', timestamp: Date.now(), data: undefined },
      sender,
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    return sendResponse.mock.calls[0]?.[0];
  }

  it("passes a message from this extension's own id to the handler and returns its result", async () => {
    const handler = vi.fn(() => true);
    unsubscribe = onTrustedMessage('getPageWorking', handler);

    expect(await deliver({ id: browser.runtime.id })).toEqual({ res: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('by default rejects a message from another sender with an error, without calling the handler', async () => {
    const handler = vi.fn(() => true);
    unsubscribe = onTrustedMessage('getPageWorking', handler);

    expect(await deliver({ id: 'some-other-extension-id' })).toEqual({
      err: expect.objectContaining({ message: '[prism] rejected a message from an untrusted sender' }),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("with onUntrusted: 'ignore', answers another sender with nothing, without calling the handler", async () => {
    const handler = vi.fn(() => true);
    unsubscribe = onTrustedMessage('getPageWorking', handler, { onUntrusted: 'ignore' });

    expect(await deliver({})).toEqual({ res: undefined });
    expect(handler).not.toHaveBeenCalled();
  });
});
