// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { LanguageDetectionResult, LanguageDetector } from '../languageDetector';
import { createBlockLanguageFilter } from './blockLanguageFilter';

function fakeDetector(byText: Record<string, LanguageDetectionResult | null>): LanguageDetector {
  return {
    detect: vi.fn(async (text: string) => byText[text] ?? null),
  };
}

const ENGLISH_RELIABLE: LanguageDetectionResult = { language: 'en', isReliable: true, percentage: 90 };
const VIETNAMESE_RELIABLE: LanguageDetectionResult = { language: 'vi', isReliable: true, percentage: 92 };

describe('createBlockLanguageFilter', () => {
  it('skips a short leaf whose enclosing container has enough aggregate text to detect confidently', async () => {
    // Real repro shape: a short button inside a filter panel with plenty
    // of other English text once you look at the container.
    document.body.innerHTML =
      '<div id="panel"><p>Chapters</p><p>Sorting</p><p>Novel type</p><button>History</button><p>Upload status</p></div>';
    const panel = document.getElementById('panel');
    const panelText = panel?.textContent?.trim() ?? '';
    const detector = fakeDetector({ [panelText]: ENGLISH_RELIABLE });
    const filter = createBlockLanguageFilter(detector);

    const skip = await filter.computeSkipElements(document.body, 'en');

    expect(skip.has(panel as Element)).toBe(true);
  });

  it('does not skip when no ancestor ever accumulates enough text within the level budget', async () => {
    // Deeply isolated short label with no siblings anywhere nearby.
    let html = '<span>Hi</span>';
    for (let i = 0; i < 10; i++) html = `<div>${html}</div>`;
    document.body.innerHTML = html;
    const detector = fakeDetector({});
    const filter = createBlockLanguageFilter(detector);

    const skip = await filter.computeSkipElements(document.body, 'en');

    expect(skip.size).toBe(0);
  });

  it('does not skip when detection is unreliable', async () => {
    document.body.innerHTML = '<div id="panel"><p>Mixed content that is genuinely ambiguous here</p></div>';
    const panel = document.getElementById('panel');
    const panelText = panel?.textContent?.trim() ?? '';
    const detector = fakeDetector({ [panelText]: { language: 'en', isReliable: false, percentage: 90 } });
    const filter = createBlockLanguageFilter(detector);

    const skip = await filter.computeSkipElements(document.body, 'en');

    expect(skip.size).toBe(0);
  });

  it('does not skip when confidence is below the threshold', async () => {
    document.body.innerHTML = '<div id="panel"><p>Some reasonably long piece of ambiguous text here</p></div>';
    const panel = document.getElementById('panel');
    const panelText = panel?.textContent?.trim() ?? '';
    const detector = fakeDetector({ [panelText]: { language: 'en', isReliable: true, percentage: 40 } });
    const filter = createBlockLanguageFilter(detector);

    const skip = await filter.computeSkipElements(document.body, 'en');

    expect(skip.size).toBe(0);
  });

  it('does not skip when the detected language does not match the target', async () => {
    document.body.innerHTML = '<div id="panel"><p>Đây là một đoạn văn bản tiếng Việt khá dài</p></div>';
    const panel = document.getElementById('panel');
    const panelText = panel?.textContent?.trim() ?? '';
    const detector = fakeDetector({ [panelText]: VIETNAMESE_RELIABLE });
    const filter = createBlockLanguageFilter(detector);

    const skip = await filter.computeSkipElements(document.body, 'en');

    expect(skip.size).toBe(0);
  });

  it('memoizes per container: a second call with unchanged text does not re-invoke the detector', async () => {
    document.body.innerHTML =
      '<div id="panel"><p>Chapters</p><p>Sorting</p><p>Novel type</p><button>History</button><p>Upload status</p></div>';
    const panel = document.getElementById('panel');
    const panelText = panel?.textContent?.trim() ?? '';
    const detector = fakeDetector({ [panelText]: ENGLISH_RELIABLE });
    const filter = createBlockLanguageFilter(detector);

    await filter.computeSkipElements(document.body, 'en');
    await filter.computeSkipElements(document.body, 'en');

    expect(detector.detect).toHaveBeenCalledTimes(1);
  });

  it('re-detects a container once its aggregate text length changes', async () => {
    // First state must itself already clear the detection floor (40 chars)
    // — otherwise the first call finds no detectable container at all
    // (0 calls) and the second call's 1 call looks identical to "memoized,
    // not re-detected" instead of "detected twice." Caught by actually
    // asserting on call count, not just skip-set membership.
    document.body.innerHTML =
      '<div id="panel"><p>Chapters</p><p>Sorting</p><p>Novel type</p><button>History</button><p>Upload status</p></div>';
    const panel = document.getElementById('panel');
    const firstText = panel?.textContent?.trim() ?? '';
    const detector = fakeDetector({ [firstText]: ENGLISH_RELIABLE });
    const filter = createBlockLanguageFilter(detector);
    await filter.computeSkipElements(document.body, 'en');
    expect(detector.detect).toHaveBeenCalledTimes(1);

    const extra = document.createElement('p');
    extra.textContent = 'Even more content here';
    panel?.appendChild(extra);
    const secondText = panel?.textContent?.trim() ?? '';
    expect(secondText.length).not.toBe(firstText.length);
    (detector.detect as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => null);

    await filter.computeSkipElements(document.body, 'en');

    expect(detector.detect).toHaveBeenCalledTimes(2);
  });
});
