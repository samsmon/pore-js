// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { gsapAdapter, type GsapLike } from './gsap-adapter.js';

function fakeGsap() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const g: GsapLike = {
    to: (...args) => (calls.push({ fn: 'to', args }), undefined),
    fromTo: (...args) => (calls.push({ fn: 'fromTo', args }), undefined),
    set: (...args) => (calls.push({ fn: 'set', args }), undefined),
    killTweensOf: (...args) => calls.push({ fn: 'killTweensOf', args }),
  };
  return { g, calls };
}

describe('gsapAdapter', () => {
  it('page() slides from → to on the axis with an eased tween + fade', () => {
    const { g, calls } = fakeGsap();
    const el = document.createElement('div');
    gsapAdapter(g, { duration: 0.3 }).page(el, -100, -420, { axis: 'x', dir: 1, reduced: false });

    const set = calls.find((c) => c.fn === 'set');
    expect(set?.args[1]).toMatchObject({ x: -100 });
    const to = calls.find((c) => c.fn === 'to');
    expect(to?.args[1]).toMatchObject({ x: -420, duration: 0.3, ease: 'power2.out' });
    expect(calls.some((c) => c.fn === 'fromTo')).toBe(true); // the turn fade
  });

  it('page() with dir 0 does not fade (a jump, not a turn)', () => {
    const { g, calls } = fakeGsap();
    gsapAdapter(g).page(document.createElement('div'), 0, -300, {
      axis: 'x',
      dir: 0,
      reduced: false,
    });
    expect(calls.some((c) => c.fn === 'fromTo')).toBe(false);
  });

  it('reduced motion applies the transform instantly, no tween', () => {
    const { g, calls } = fakeGsap();
    const el = document.createElement('div');
    gsapAdapter(g).page(el, 0, 240, { axis: 'y', dir: -1, reduced: true });
    expect(el.style.transform).toBe('translateY(240px)');
    expect(calls.some((c) => c.fn === 'to')).toBe(false);
    expect(calls.some((c) => c.fn === 'killTweensOf')).toBe(true);
  });

  it('scrollTo() eases the scroll prop unless reduced', () => {
    const { g, calls } = fakeGsap();
    const el = document.createElement('div');
    const a = gsapAdapter(g);
    a.scrollTo(el, 'scrollTop', 900, false);
    expect(calls.at(-1)).toMatchObject({ fn: 'to' });
    expect((calls.at(-1)!.args[1] as Record<string, unknown>).scrollTop).toBe(900);

    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true });
    a.scrollTo(el, 'scrollTop', 500, true);
    expect(el.scrollTop).toBe(500);
  });

  it('cancel() kills tweens on every element it has touched', () => {
    const { g, calls } = fakeGsap();
    const a = gsapAdapter(g);
    const el1 = document.createElement('div');
    const el2 = document.createElement('div');
    a.page(el1, 0, -10, { axis: 'x', dir: 1, reduced: false });
    a.zoom(el2, 'scale(2)', false);
    calls.length = 0;
    a.cancel();
    const killed = calls.filter((c) => c.fn === 'killTweensOf').map((c) => c.args[0]);
    expect(killed).toContain(el1);
    expect(killed).toContain(el2);
  });
});
