// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { elementSteps, parseCfi, resolveCfiElement, resolveCfiRange, serializeCfi } from './cfi.js';

function docWith(bodyHtml: string): Document {
  return new DOMParser().parseFromString(`<html><body>${bodyHtml}</body></html>`, 'text/html');
}

describe('elementSteps / resolveCfiElement', () => {
  it('round-trips a nested element position', () => {
    const doc = docWith('<div><h1>Title</h1><p>One</p><p>Two</p></div>');
    const secondP = doc.querySelectorAll('p')[1]!;
    const steps = elementSteps(doc, secondP);
    expect(resolveCfiElement(doc, steps)).toBe(secondP);
  });

  it('returns null when the path no longer exists', () => {
    const doc = docWith('<p>Only one</p>');
    expect(resolveCfiElement(doc, [2, 4, 6])).toBeNull();
  });
});

describe('serializeCfi / parseCfi', () => {
  it('produces genuine epubcfi(...) syntax', () => {
    const doc = docWith('<p>Hello world</p>');
    const p = doc.querySelector('p')!;
    const cfi = serializeCfi(doc, 2, 'ch03', p, 6);
    expect(cfi).toMatch(/^epubcfi\(\/6\/6\[ch03\]!\/\d+:6\)$/);
  });

  it('round-trips spine index, idref and offset through parse', () => {
    const doc = docWith('<p>Hello world</p>');
    const p = doc.querySelector('p')!;
    const cfi = serializeCfi(doc, 4, 'chap-09', p, 6);
    const parsed = parseCfi(cfi)!;
    expect(parsed).toMatchObject({ spineIndex: 4, spineIdref: 'chap-09', offset: 6 });
    expect(resolveCfiElement(doc, parsed.steps)).toBe(p);
  });

  it('escapes structural characters in the idref assertion and reverses it on parse', () => {
    const doc = docWith('<p>x</p>');
    const p = doc.querySelector('p')!;
    const cfi = serializeCfi(doc, 0, 'weird[id],here', p, 0);
    const parsed = parseCfi(cfi)!;
    expect(parsed.spineIdref).toBe('weird[id],here');
  });

  it('rejects a string that is not CFI-shaped', () => {
    expect(parseCfi('not a cfi')).toBeNull();
    expect(parseCfi('epubcfi(/6/6[x]!/4/2)')).toBeNull(); // missing :offset
  });

  it('round-trips through nested inline markup (em/strong/a) inside the target block', () => {
    const doc = docWith(
      '<div><p>lead-in</p><p>alpha <em>beta</em> <strong><a href="#">gamma</a></strong> delta</p></div>',
    );
    const p = doc.querySelectorAll('p')[1]!;
    const offset = p.textContent!.indexOf('gamma'); // inside <strong><a>
    const cfi = serializeCfi(doc, 1, 'ch02', p, offset);

    const parsed = parseCfi(cfi)!;
    const resolvedEl = resolveCfiElement(doc, parsed.steps);
    expect(resolvedEl).toBe(p);

    const range = resolveCfiRange(doc, parsed)!;
    expect(range).not.toBeNull();
    expect(range.startContainer.textContent).toBe('gamma');
    expect(range.startContainer.parentElement?.tagName).toBe('A');
  });

  it('resolveCfiRange returns null when the document has drifted', () => {
    const doc = docWith('<p>short</p>');
    const parsed = parseCfi('epubcfi(/6/6[x]!/99:0)')!;
    expect(resolveCfiRange(doc, parsed)).toBeNull();
  });
});
