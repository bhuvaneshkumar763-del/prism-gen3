/**
 * Session 2's minimal vertical slice: find the page's first <p>, expose
 * its text to the popup, and apply a translated replacement back onto it.
 * This is NOT the real page-translation engine (that's Session 5's
 * dedupe/mutationWatcher/resweep/grouping/translateLoop machinery,
 * redesigned fresh from the old repo's lessons) — just enough DOM
 * plumbing to prove the whole pipeline (popup click -> background ->
 * engine -> real network call -> back to a real page) works end to end.
 */
export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    interface GetSampleTextMessage {
      type: 'getSampleText';
    }
    interface ApplyTranslatedTextMessage {
      type: 'applyTranslatedText';
      text: string;
    }

    function isGetSampleTextMessage(message: unknown): message is GetSampleTextMessage {
      return (
        typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'getSampleText'
      );
    }
    function isApplyTranslatedTextMessage(message: unknown): message is ApplyTranslatedTextMessage {
      return (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === 'applyTranslatedText'
      );
    }

    function firstParagraph(): HTMLParagraphElement | null {
      return document.querySelector('p');
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isGetSampleTextMessage(message)) {
        const p = firstParagraph();
        sendResponse(p ? p.textContent : null);
        return false;
      }
      if (isApplyTranslatedTextMessage(message)) {
        const p = firstParagraph();
        if (p) p.textContent = message.text;
        sendResponse(true);
        return false;
      }
      return undefined;
    });
  },
});
